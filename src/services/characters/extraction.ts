import { createId } from '../../utils/id.js'
import { streamChatMessage } from '../api/client.js'
import { DEFAULT_CHAT_MODEL, resolveSessionHeaders, type ChatConfig } from '../api/chatConfig.js'
import type { CreateMessageRequest } from '../api/types.js'
import { debugLog } from '../debug/log.js'
import { useSettings } from '../settings.js'
import { isMemoryEnabled, upsertMemory, useCharacters } from './store.js'
import { isMemoryDimension, MEMORY_CONTENT_LIMIT, type MemoryCard } from './types.js'

/**
 * 记忆自动提取：回答成功后，把本轮用户文本交给模型整理成记忆卡。
 * - 按角色串行执行，避免同角色任务互相覆盖；
 * - 提取期间角色记忆被手动修改（指纹变化）则放弃本次结果；
 * - 与已有卡按「同维度 + 同内容」去重；新卡自动启用，来源记录会话与逐字证据。
 * 任何失败都静默放弃，不影响聊天主流程。
 */

const EXTRACTOR_SYSTEM = [
  '你是记忆提取器。从用户消息中提取值得长期记住的用户信息，只输出一个 JSON 数组，不要输出其他内容。',
  '每项形如 {"dimension":"...","content":"...","quote":"...","importance":0}：',
  '- dimension 必须是 preference | daily | social | experience | goal | communication | trait | emotion 之一；',
  '- content 以「用户」为主体的第三人称事实描述，不超过 200 字；',
  '- quote 是支撑该记忆的用户原话片段，必须逐字出现在用户消息原文中；',
  '- importance 可选：0=普通，1=重要（用户明确要求记住的重要事实），2=关键（身份/健康/安全）。',
  '规则：只提取用户的喜好、习惯、重要关系、过往经历、长期目标、沟通偏好、自述特点、情绪支持需求；',
  '用户说「记住…」时必须提取（importance 至少 1）；',
  '不要提取事实问答、代码、临时任务或一次性话题；最多 6 项；没有值得记住的内容时输出 []。',
].join('\n')

type ExtractedItem = { dimension: string; content: string; quote?: string; importance?: number }

const sameText = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '')

/** 同角色任务串行队列 */
const queues = new Map<string, Promise<unknown>>()

const enqueue = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) ?? Promise.resolve()
  const task = previous.then(run, run)
  queues.set(
    key,
    task.catch(() => undefined)
  )
  return task
}

const collectText = async (config: ChatConfig, body: CreateMessageRequest): Promise<string> => {
  const { apiKey } = useSettings.getState()
  let text = ''
  for await (const event of streamChatMessage(
    config,
    apiKey ?? '',
    body,
    new AbortController().signal
  )) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  return text
}

const parseItems = (text: string): ExtractedItem[] => {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? (parsed as ExtractedItem[]) : []
  } catch {
    return []
  }
}

/** 记忆指纹：提取期间被手动维护（增删改）时放弃结果，避免覆盖。 */
const fingerprint = (characterId: string) =>
  (useCharacters.getState().memories[characterId] ?? [])
    .map((card) => card.updatedAt)
    .join(',')

export const enqueueMemoryExtraction = (
  characterId: string | null | undefined,
  sessionId: string,
  userText: string
): Promise<number> => {
  const text = userText.trim()
  if (!text || !isMemoryEnabled(characterId)) {
    return Promise.resolve(0)
  }
  // 默认角色（null）的记忆挂在 `default` 名下。
  const targetId = characterId ?? 'default'
  return enqueue(targetId, async () => {
    try {
      const before = fingerprint(targetId)
      const body: CreateMessageRequest = {
        model: useSettings.getState().chatConfig.model || DEFAULT_CHAT_MODEL,
        max_tokens: 4096,
        system: EXTRACTOR_SYSTEM,
        messages: [{ role: 'user', content: text }],
        thinking: { type: 'disabled' },
      }
      // 提取请求同样应用自定义头与 {sessionId} 占位符（OpenCode 等网关要求）
      const config = resolveSessionHeaders(useSettings.getState().chatConfig, sessionId)
      const items = parseItems(await collectText(config, body)).slice(0, 6)
      if (fingerprint(targetId) !== before) {
        return 0
      }
      const existing = useCharacters.getState().memories[targetId] ?? []
      const now = Date.now()
      let added = 0
      for (const item of items) {
        const content = typeof item?.content === 'string' ? item.content.trim() : ''
        const quote = typeof item?.quote === 'string' ? item.quote : ''
        if (
          !content ||
          content.length > MEMORY_CONTENT_LIMIT ||
          !isMemoryDimension(item?.dimension) ||
          !quote ||
          !text.includes(quote)
        ) {
          continue
        }
        // 同维度同内容视为重复，跳过。
        if (
          existing.some(
            (card) => card.dimension === item.dimension && sameText(card.content, content)
          )
        ) {
          continue
        }
        const card: MemoryCard = {
          id: createId(),
          characterId: targetId,
          dimension: item.dimension,
          content,
          source: { sessionId, messageId: undefined, quote },
          enabled: true,
          // 用户明确要求记住 → 重要；普通提炼 → 普通
          importance: item.importance === 1 || item.importance === 2 ? item.importance : 0,
          createdAt: now,
          updatedAt: now,
        }
        existing.push(card)
        upsertMemory(card)
        added += 1
      }
      if (added > 0) {
        debugLog('event', `记忆提取完成 · 新增 ${added} 条`)
      }
      return added
    } catch (error) {
      debugLog('event', '记忆提取失败', error instanceof Error ? error.message : String(error))
      // 提取失败静默保留原上下文，只在控制台留痕。
      // eslint-disable-next-line no-console
      console.error('[characters] memory extraction failed', error)
      return 0
    }
  })
}
