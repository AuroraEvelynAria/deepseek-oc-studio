export const DEFAULT_CHAT_MODEL = 'deepseek-flash'

export const CHAT_API_FORMATS = {
  messages: 'Anthropic Messages',
  chat: 'OpenAI Chat Completions',
  responses: 'OpenAI Responses',
} as const

export type ChatApiFormat = keyof typeof CHAT_API_FORMATS
/** endpoint 保存实际请求地址，供网页与 Android 共用。 */
export type ChatConfig = {
  model: string
  endpoint: string
  format: ChatApiFormat
  apiKey: string
  /** 额外请求头；值支持 {sessionId} 占位符（发送时替换为会话 ID） */
  headers?: Record<string, string>
  /** 端点透传 DeepSeek 官方扩展（联网搜索/思考开关/自动标题）时为 true */
  compatible?: boolean
}

export const CHAT_API_PATHS: Record<ChatApiFormat, string> = {
  messages: '/messages',
  chat: '/chat/completions',
  responses: '/responses',
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  model: '',
  endpoint: '',
  format: 'messages',
  apiKey: '',
}

const parseChatEndpoint = (value: string) => {
  if (!/^https?:\/\//i.test(value)) {
    return null
  }
  try {
    const url = new URL(value)
    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      !url.href.includes('#')
    ) {
      return url.href
    }
  } catch {
    // 无效地址由设置表单提示。
  }
  return null
}

export const chatBaseUrl = (value: string, format: ChatApiFormat) => {
  const endpoint = parseChatEndpoint(value.trim())
  if (!endpoint) {
    return null
  }
  const url = new URL(endpoint)
  const path = url.pathname.replace(/\/+$/, '')
  const suffix = CHAT_API_PATHS[format]
  url.pathname = path.endsWith(suffix) ? path.slice(0, -suffix.length) : path
  return url.href
}

export const resolveChatEndpoint = (
  value: string,
  format: ChatApiFormat,
  previous = DEFAULT_CHAT_CONFIG
) => {
  if (!value.trim()) {
    return ''
  }
  const base = chatBaseUrl(value, format)
  if (!base) {
    return null
  }
  // 原来保存的是完整地址。编辑其他设置时沿用该地址，兼容网关的自定义路由。
  if (format === previous.format && base === chatBaseUrl(previous.endpoint, format)) {
    return previous.endpoint
  }
  const url = new URL(base)
  const path = url.pathname.replace(/\/+$/, '')
  const version = format === 'messages' && !path.endsWith('/v1') ? '/v1' : ''
  url.pathname = path + version + CHAT_API_PATHS[format]
  return url.href
}

/** 校验自定义头表：名字与值都必须是非空字符串。 */
const parseHeaders = (value: unknown): Record<string, string> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const headers: Record<string, string> = {}
  let valid = false
  for (const [name, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof name === 'string' && name.trim() && typeof headerValue === 'string') {
      headers[name.trim()] = headerValue
      valid = true
    }
  }
  return valid ? headers : undefined
}

/**
 * 替换自定义头里的 {sessionId} 占位符：OpenCode 等网关要求每个对话
 * 携带稳定的会话 ID，调用方按当前会话替换后使用。
 */
export const resolveSessionHeaders = (
  config: ChatConfig,
  sessionId: string
): ChatConfig =>
  config.headers
    ? {
        ...config,
        headers: Object.fromEntries(
          Object.entries(config.headers).map(([name, value]) => [
            name,
            value.replaceAll('{sessionId}', sessionId),
          ])
        ),
      }
    : config

export const readChatConfig = (stored: string | null): ChatConfig => {
  try {
    const value = JSON.parse(stored ?? 'null') as Partial<ChatConfig> | null
    const model = typeof value?.model === 'string' ? value.model.trim() : ''
    const endpoint = typeof value?.endpoint === 'string' ? parseChatEndpoint(value.endpoint) : null
    const format = value?.format
    if (format === 'messages' || format === 'chat' || format === 'responses') {
      return {
        model,
        endpoint: endpoint ?? '',
        format,
        apiKey: endpoint && typeof value?.apiKey === 'string' ? value.apiKey : '',
        headers: endpoint ? parseHeaders(value?.headers) : undefined,
        compatible: endpoint === null || endpoint === '' ? false : value?.compatible === true,
      }
    }
    return { ...DEFAULT_CHAT_CONFIG, model }
  } catch {
    return DEFAULT_CHAT_CONFIG
  }
}
