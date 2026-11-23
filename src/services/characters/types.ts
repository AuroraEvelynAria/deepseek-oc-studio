/**
 * 角色卡与记忆库的数据结构。
 * 角色绑定人设提示词，记忆按角色隔离；两者存放在独立的 IndexedDB（`replica`），
 * 与会话历史（`chat-demo` 库）完全隔离，清除历史、ZIP 导入互不影响。
 */

/** 默认角色（官方 DeepSeek）：不落库的虚拟角色，仅有可开关的记忆能力。 */
export const DEFAULT_CHARACTER_ID = 'default'

/** 记忆的八个维度，参考陪伴型记忆系统的通用分类。 */
export const MEMORY_DIMENSIONS = [
  'preference',
  'daily',
  'social',
  'experience',
  'goal',
  'communication',
  'trait',
  'emotion',
] as const

export type MemoryDimension = (typeof MEMORY_DIMENSIONS)[number]

export type Character = {
  id: string
  name: string
  /** 头像：居中裁剪后的 webp dataURL；null 时用名字首字占位。 */
  avatar: string | null
  /** 角色人设，作为请求的 system 提示词。 */
  prompt: string
  /** 是否启用记忆库（回复注入 + 自动提取）。 */
  memoryEnabled: boolean
  createdAt: number
  updatedAt: number
}

export type MemorySource = {
  sessionId: string
  /** 提取时的会话消息 id；手动维护时缺省。 */
  messageId?: string
  /** 记忆依据的用户原话片段（逐字证据）；手动维护时可为空串。 */
  quote: string
}

export type MemoryCard = {
  id: string
  characterId: string
  dimension: MemoryDimension
  /** 以「用户」为主体的事实描述，上限 800 字。 */
  content: string
  source: MemorySource | null
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export const isMemoryDimension = (value: unknown): value is MemoryDimension =>
  typeof value === 'string' && (MEMORY_DIMENSIONS as readonly string[]).includes(value)

/** 单张记忆正文上限（字） */
export const MEMORY_CONTENT_LIMIT = 800
