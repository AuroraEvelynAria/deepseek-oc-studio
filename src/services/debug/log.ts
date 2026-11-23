import { create } from 'zustand'

/**
 * 开发者控制台的日志核心：内存环形缓冲 + localStorage 节流持久化。
 * 日志可能包含请求头，敏感字段（Authorization / x-api-key）在写入前统一打码。
 */

const STORAGE_KEY = 'replica:debug-log'
const MAX_ENTRIES = 300
const FLUSH_DELAY = 400

export type DebugKind = 'request' | 'native' | 'error' | 'event' | 'state' | 'eval'

export type DebugEntry = {
  id: number
  at: number
  kind: DebugKind
  title: string
  detail?: string
}

type DebugState = {
  entries: DebugEntry[]
}

export const useDebugLog = create<DebugState>(() => ({
  entries: [],
}))

const { getState: get, setState: set } = useDebugLog

let sequence = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null

const load = (): DebugEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DebugEntry[]).slice(-MAX_ENTRIES) : []
  } catch {
    return []
  }
}

/** 节流持久化：日志爆发写入时合并为一次 localStorage 写。 */
const scheduleFlush = () => {
  if (flushTimer) {
    return
  }
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(get().entries))
    } catch {
      // 存储满或隐私模式：仅保留内存日志
    }
  }, FLUSH_DELAY)
}

export const initDebugLog = () => {
  if (get().entries.length > 0) {
    return
  }
  set({ entries: load() })
}

export const clearDebugLog = () => {
  sequence = 0
  set({ entries: [] })
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略存储错误
  }
}

const push = (kind: DebugKind, title: string, detail?: string) => {
  sequence += 1
  const entry: DebugEntry = {
    id: sequence,
    at: Date.now(),
    kind,
    title,
    detail,
  }
  set((state) => ({ entries: [...state.entries, entry].slice(-MAX_ENTRIES) }))
  scheduleFlush()
  return entry
}

/** 记录一条调试日志；detail 传任意可序列化数据（自动 JSON 化并截断超长文本）。 */
export const debugLog = (kind: DebugKind, title: string, detail?: unknown): void => {
  try {
    if (detail === undefined) {
      push(kind, title)
      return
    }
    let text: string
    if (typeof detail === 'string') {
      text = detail
    } else {
      text = JSON.stringify(
        detail,
        (_key, value) => (typeof value === 'string' && value.length > 4000 ? `${value.slice(0, 4000)}…(截断)` : value),
        2
      )
    }
    if (text.length > 8000) {
      text = `${text.slice(0, 8000)}…(截断)`
    }
    push(kind, title, text)
  } catch {
    // 日志失败绝不影响主流程
  }
}

const SENSITIVE_HEADERS = ['authorization', 'x-api-key']

/** 请求头脱敏：认证类头的值只保留前 6 位与长度信息。 */
export const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADERS.includes(name.toLowerCase()) && value.length > 6
        ? `${value.slice(0, 6)}***(${value.length})`
        : value,
    ])
  )
