import { android } from '../../app/android.js'
import { translate, type TranslationMessage } from '../../i18n/index.js'
import { debugLog, sanitizeHeaders } from '../debug/log.js'
import { CHAT_API_PATHS, type ChatConfig } from './chatConfig.js'
import { openAIRequest, readOpenAIFrame } from './openaiChat.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** Anthropic 兼容接口的前缀 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number,
    readonly code?: string
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
    // 开发者控制台：一处埋点捕获全部 API 错误
    debugLog('error', `API ${kind}${status ? ` · HTTP ${status}` : ''}`, {
      message: this.message,
      code,
    })
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  let code: string | undefined
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
      code = typeof body.error.code === 'string' ? body.error.code : undefined
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status, code)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  debugLog('request', `非流请求 · ${init.method ?? 'GET'} ${url}`, {
    body: typeof init.body === 'string' ? init.body.slice(0, 600) : undefined,
  })
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  debugLog('request', `非流响应 · HTTP ${response.status} · ${url}`)
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (
  apiKey: string,
  fileId: string,
  signal?: AbortSignal
): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
    signal,
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      message.role === 'user' &&
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type !== 'text' && block.source.type === 'file')
  )

const openMessageStream = (apiKey: string, body: CreateMessageRequest, signal: AbortSignal) => {
  // 开发者控制台：记录官方 messages 请求（含脱敏头与 body 摘要）
  debugLog('request', '流式请求 · messages · 官方端点', {
    headers: sanitizeHeaders(anthropicHeaders(apiKey, hasFile(body))),
    body: JSON.stringify({ ...body, stream: true }).slice(0, 3000),
  })
  return request(`${ANTHROPIC_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
}

const withDeepSeekExtensionsFallback = (
  body: CreateMessageRequest,
  send: (requestBody: CreateMessageRequest) => Promise<Response>
) =>
  send(body).catch((error: unknown) => {
    if (
      !(body.tools?.length || body.safety_check || body.title?.enabled) ||
      !(error instanceof ApiError) ||
      error.status !== 400 ||
      !/\buser input too long, \d+ tokens exceeds max 32768 tokens\b/i.test(error.message)
    ) {
      throw error
    }
    // 扩展模式在生成前拒绝长输入时，用同一协议的基础模式发送同一上下文。
    return send({ ...body, tools: undefined, safety_check: undefined, title: undefined })
  })

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
async function* streamMessage(apiKey: string, body: CreateMessageRequest, signal: AbortSignal) {
  const response = await withDeepSeekExtensionsFallback(body, (requestBody) =>
    openMessageStream(apiKey, requestBody, signal)
  )
  yield* readAnthropicStream(response, signal)
}

async function* readStreamPayloads(response: Response, signal: AbortSignal) {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.toLowerCase().includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    signal.throwIfAborted()
    if (data === '[DONE]') {
      yield { done: true } as const
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      const { message, code } = payload.error
      throw new ApiError('stream', message, undefined, typeof code === 'string' ? code : undefined)
    }
    if (eventName === 'error' && !payload) {
      throw new ApiError('stream', data)
    }
    yield { done: false, payload, eventName, data } as const
  }
  signal.throwIfAborted()
}

async function* readAnthropicStream(response: Response, signal: AbortSignal) {
  for await (const frame of readStreamPayloads(response, signal)) {
    if (frame.done) {
      break
    }
    const { payload, eventName, data } = frame
    if (eventName === 'error') {
      const detail = payload as { error?: { message?: unknown; type?: unknown } } | null
      const error = detail?.error
      throw new ApiError(
        'stream',
        typeof error?.message === 'string' ? error.message : data,
        undefined,
        typeof error?.type === 'string' ? error.type : undefined
      )
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

/**
 * 自定义 messages 端点：默认只发基础字段（第三方 Anthropic 兼容网关对未知字段敏感）；
 * compatible 网关（透传 DeepSeek 官方扩展）才带上 tools/thinking/safety/title。
 */
const customMessagesRequest = (body: CreateMessageRequest, deepSeek: boolean) => ({
  model: body.model,
  system: body.system || undefined,
  max_tokens: body.max_tokens,
  messages: body.messages.flatMap((message): CreateMessageRequest['messages'] => {
    if (message.role === 'latest_reminder') {
      return []
    }
    if (message.role === 'assistant') {
      const content = message.content.filter((block) => block.type === 'text')
      return content.length ? [{ ...message, content }] : []
    }
    return [message]
  }),
  stream: true,
  ...(deepSeek
    ? {
        tools: body.tools?.length ? body.tools : undefined,
        safety_check: body.safety_check,
        title: body.title,
        thinking: body.thinking,
      }
    : {}),
})

type NativeChatEvent = { id: string } & (
  | { type: 'headers'; status: number; mime: string }
  | { type: 'data'; bytes: string }
  | { type: 'end' | 'error' }
)

const openAndroidChat = (
  device: NonNullable<typeof android>,
  config: ChatConfig,
  body: string,
  signal: AbortSignal
) => {
  let id: string | null = null
  let headersReceived = false
  let receiver: ReadableStreamDefaultController<Uint8Array>
  let resolve: (response: Response) => void
  let reject: (error: unknown) => void
  const response = new Promise<Response>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  const close = () => {
    window.removeEventListener('android-custom-chat', onChunk)
    signal.removeEventListener('abort', onAbort)
    if (id) {
      device.cancelChatRequest(id)
      id = null
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      receiver = controller
    },
    cancel: close,
  })
  const fail = (error: unknown) => {
    close()
    if (headersReceived) {
      receiver.error(error)
    } else {
      reject(error)
    }
  }
  const onAbort = () => fail(signal.reason)
  const onChunk = (event: Event) => {
    const chunk = (event as CustomEvent<NativeChatEvent>).detail
    if (chunk?.id !== id) {
      return
    }
    switch (chunk.type) {
      case 'headers': {
        headersReceived = true
        debugLog('native', `原生通道响应 · HTTP ${chunk.status} · ${chunk.mime}`)
        const bodyStream = chunk.status === 204 || chunk.status === 205 ? null : stream
        resolve(
          new Response(bodyStream, {
            status: chunk.status,
            headers: { 'Content-Type': chunk.mime },
          })
        )
        break
      }
      case 'data':
        receiver.enqueue(Uint8Array.from(atob(chunk.bytes), (char) => char.charCodeAt(0)))
        break
      case 'end':
        close()
        receiver.close()
        break
      case 'error':
        debugLog('native', '原生通道错误 · 连接未建立或读取失败')
        fail(new ApiError('network', ''))
        break
    }
  }
  window.addEventListener('android-custom-chat', onChunk)
  signal.addEventListener('abort', onAbort, { once: true })
  // 4 参重载携带自定义头；旧版 APK（3 参）会在 Java Bridge 层静默失配 → id 为 null → 走 protocol 错误兜底
  id = device.beginChatRequest(config.endpoint, config.format, JSON.stringify(config.headers ?? {}), body)
  if (!id) {
    fail(new ApiError('protocol', { key: 'advancedConnectionChanged' }))
  }
  return { response, close }
}

export const streamChatMessage = (
  config: ChatConfig,
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
) => {
  if (config.endpoint) {
    // 兼容网关（透传 DeepSeek 官方扩展）按官方方式发送扩展字段
    return streamCompatibleMessage(config, body, signal, config.compatible === true, true)
  }
  if (config.format === 'messages') {
    return streamMessage(apiKey, body, signal)
  }
  const endpoint = `${API_ORIGIN}${CHAT_API_PATHS[config.format]}`
  // 合成出来的官方端点必须走 fetch：原生通道按「已保存的自定义配置」校验端点与 Key，
  // 官方端点的 chatConfig.endpoint 是空串，交给原生只会得到协议错误。
  return streamCompatibleMessage({ ...config, endpoint, apiKey }, body, signal, true, false)
}

async function* streamCompatibleMessage(
  config: ChatConfig,
  body: CreateMessageRequest,
  signal: AbortSignal,
  deepSeek: boolean,
  nativeAllowed: boolean
): AsyncGenerator<MessageStreamEvent> {
  const { endpoint, format, apiKey } = config
  const serialize = (requestBody: CreateMessageRequest) =>
    JSON.stringify(
      format === 'messages'
        ? customMessagesRequest(requestBody, deepSeek)
        : openAIRequest(format, requestBody, deepSeek)
    )
  signal.throwIfAborted()
  const builtInHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(format === 'messages'
      ? {
          'anthropic-version': '2023-06-01',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          ...(new URL(endpoint).hostname === 'api.anthropic.com'
            ? { 'anthropic-dangerous-direct-browser-access': 'true' }
            : {}),
        }
      : apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : {}),
  }
  // 自定义头后应用（与原生通道一致）：允许覆盖认证头；同名头按大小写不敏感去重。
  const headerMap = new Map<string, [string, string]>()
  for (const [name, value] of Object.entries(builtInHeaders)) {
    headerMap.set(name.toLowerCase(), [name, value])
  }
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    headerMap.set(name.toLowerCase(), [name, value])
  }
  const requestHeaders = Object.fromEntries(headerMap.values())
  // 开发者控制台：记录最终请求（含脱敏头与 body 摘要）
  debugLog('request', `流式请求 · ${format} · ${endpoint}`, {
    headers: sanitizeHeaders(requestHeaders),
    body: serialize(body).slice(0, 3000),
  })
  // 兼容网关（透传 DeepSeek 官方扩展）在 Android 上同样走原生通道：绕 CORS 且支持自定义头；
  // 合成出来的官方端点除外（nativeAllowed=false）。
  const native =
    android && nativeAllowed && (!deepSeek || config.compatible === true)
      ? openAndroidChat(android, config, serialize(body), signal)
      : undefined
  if (native) {
    debugLog('native', `原生通道启动 · ${config.endpoint}`, {
      headers: sanitizeHeaders(config.headers ?? {}),
    })
  }
  try {
    const send = (requestBody: CreateMessageRequest) =>
      request(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: serialize(requestBody),
        credentials: 'omit',
        redirect: 'error',
        signal,
      })
    const response = native
      ? await native.response
      : deepSeek
        ? await withDeepSeekExtensionsFallback(body, send)
        : await send(body)
    if (!response.ok) {
      throw await readErrorResponse(response, 'http', `HTTP ${response.status}`)
    }
    if (format === 'messages') {
      yield* readAnthropicStream(response, signal)
      return
    }
    let block: 'text' | 'thinking' | undefined
    let index = -1
    let stop: StopReason | undefined
    let usage: MessageUsage | undefined
    let title: string | undefined
    let complete = false
    for await (const packet of readStreamPayloads(response, signal)) {
      if (packet.done) {
        complete = format === 'chat' && (index >= 0 || stop !== undefined)
        break
      }
      const frame = readOpenAIFrame(format, packet.payload)
      if (frame.error) {
        throw new ApiError('stream', frame.error.message, undefined, frame.error.code)
      }
      if (packet.eventName === 'error') {
        throw new ApiError('stream', packet.data)
      }
      const deltas = [
        ['thinking', frame.thinking],
        ['text', frame.text],
      ] as const
      for (const [type, delta] of deltas) {
        if (!delta) {
          continue
        }
        if (block !== type) {
          if (block) {
            yield { type: 'content_block_stop', index }
          }
          block = type
          index += 1
          yield {
            type: 'content_block_start',
            index,
            content_block:
              type === 'text' ? { type, text: '' } : { type, thinking: '', signature: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index,
          delta:
            type === 'text'
              ? { type: 'text_delta', text: delta }
              : { type: 'thinking_delta', thinking: delta },
        }
      }
      stop = frame.stop ?? stop
      usage = frame.usage ?? usage
      title = frame.title ?? title
      if (frame.done) {
        complete = true
        break
      }
    }
    if (!complete && !(format === 'chat' && stop)) {
      throw new ApiError('interrupted', '')
    }
    if (block) {
      yield { type: 'content_block_stop', index }
    }
    yield {
      type: 'message_delta',
      delta: { stop_reason: stop ?? 'end_turn', stop_sequence: null, title },
      usage,
    }
    yield { type: 'message_stop' }
  } finally {
    native?.close()
  }
}
