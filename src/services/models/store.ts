import { create } from 'zustand'
import { loadModelPresets, putModelPreset, deleteModelPreset } from '../characters/db.js'
import type { ChatApiFormat } from '../api/chatConfig.js'
import { debugLog } from '../debug/log.js'
import { setChatConfig, useSettings } from '../settings.js'

/**
 * 模型预设：把「名称 + 模型 ID + 端点 + 格式 + Key + 能力标记」存成一组，
 * 徽章面板里一键切换。激活预设时同步写入 settings.chatConfig（发送链路唯一数据源）。
 * 注意：预设列表（含 Key）存于本地 IndexedDB，未走 Android Keystore；
 * 当前激活的 Key 会随 chatConfig 享受原有加密通道。
 */

const ACTIVE_KEY = 'replica:active-model'

export type ModelPreset = {
  id: string
  /** 显示名，如「OpenCode DeepSeek」 */
  name: string
  /** 模型 ID；官方端点留空时运行时回退 deepseek-flash */
  model: string
  /** '' 表示 DeepSeek 官方端点 */
  endpoint: string
  format: ChatApiFormat
  apiKey: string
  /** 支持视觉（图片输入）；官方端点恒为 true */
  vision: boolean
  /** 支持思考（深度思考开关可用的前提）；官方端点恒为 true */
  reasoning: boolean
  /** 端点透传 DeepSeek 官方扩展（联网搜索/思考开关/自动标题）；官方端点恒为 true */
  search: boolean
  /** 额外请求头模板；值支持 {sessionId} 占位符 */
  headers?: Record<string, string>
  createdAt: number
  updatedAt: number
}

type ModelsState = {
  ready: boolean
  presets: ModelPreset[]
  activeId: string | null
}

export const useModels = create<ModelsState>(() => ({
  ready: false,
  presets: [],
  activeId: null,
}))

const { getState: get, setState: set } = useModels

const readActiveId = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

const writeActiveId = (id: string | null) => {
  try {
    if (id === null) {
      localStorage.removeItem(ACTIVE_KEY)
    } else {
      localStorage.setItem(ACTIVE_KEY, id)
    }
  } catch {
    // 存储不可用时仅影响下次启动的默认选择
  }
}

/** 激活预设落到 chatConfig：官方预设（endpoint ''）时 Key 由全局 settings 提供 */
const applyPreset = (preset: ModelPreset) => {
  const isOfficial = preset.endpoint === ''
  void setChatConfig({
    model: preset.model,
    endpoint: preset.endpoint,
    format: preset.format,
    apiKey: isOfficial ? '' : preset.apiKey,
    headers: isOfficial ? undefined : preset.headers,
    // 联网搜索标记 = 该端点透传 DeepSeek 官方扩展（官方端点天然支持）
    compatible: isOfficial || preset.search,
  })
}

let initTask: Promise<void> | undefined

/** 启动时加载预设；首次使用自动迁移现有 chatConfig 或创建官方预设。 */
export const initModels = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  initTask ??= (async () => {
    const { chatConfig } = useSettings.getState()
    const stored = await loadModelPresets<ModelPreset>()
    let presets = stored.sort((a, b) => a.createdAt - b.createdAt)
    let activeId = readActiveId()
    if (presets.length === 0) {
      const now = Date.now()
      const official: ModelPreset = {
        id: 'official',
        name: 'DeepSeek 官方',
        model: '',
        endpoint: '',
        format: 'messages',
        apiKey: '',
        vision: true,
        reasoning: true,
        search: true,
        createdAt: now,
        updatedAt: now,
      }
      presets = [official]
      if (chatConfig.endpoint) {
        // 迁移用户已配置的自定义端点
        presets.push({
          id: `model-${now}-${Math.random().toString(36).slice(2, 8)}`,
          name: '自定义端点',
          model: chatConfig.model,
          endpoint: chatConfig.endpoint,
          format: chatConfig.format,
          apiKey: chatConfig.apiKey,
          vision: true,
          reasoning: true,
          search: false,
          createdAt: now + 1,
          updatedAt: now + 1,
        })
        activeId = presets[1].id
      } else {
        activeId = official.id
      }
      for (const preset of presets) {
        void putModelPreset(preset)
      }
    }
    const valid = activeId !== null && presets.some((item) => item.id === activeId)
    if (!valid) {
      activeId = presets[0]?.id ?? null
    }
    writeActiveId(activeId)
    set({ ready: true, presets, activeId })
    const active = presets.find((item) => item.id === activeId)
    if (active) {
      applyPreset(active)
    }
  })()
  return initTask
}

export const resolveActivePreset = (): ModelPreset | null => {
  const { presets, activeId } = get()
  return presets.find((item) => item.id === activeId) ?? null
}

/** 当前端点的视觉能力；官方端点恒支持 */
export const isVisionEnabled = (): boolean => {
  const preset = resolveActivePreset()
  return preset ? preset.vision || preset.endpoint === '' : true
}

/** 当前端点的思考能力；官方端点恒支持 */
export const isReasoningEnabled = (): boolean => {
  const preset = resolveActivePreset()
  return preset ? preset.reasoning || preset.endpoint === '' : true
}

/** 当前端点是否支持联网搜索（官方扩展）；官方端点恒支持 */
export const isSearchEnabled = (): boolean => {
  const preset = resolveActivePreset()
  return preset ? preset.search || preset.endpoint === '' : true
}

export const activatePreset = (id: string) => {
  const preset = get().presets.find((item) => item.id === id)
  if (!preset) {
    return
  }
  writeActiveId(id)
  set({ activeId: id })
  applyPreset(preset)
  debugLog('state', `切换模型预设 · ${preset.name}`, {
    model: preset.model,
    endpoint: preset.endpoint,
    format: preset.format,
    compatible: preset.endpoint === '' || preset.search,
    headers: preset.headers,
  })
}

export const savePreset = (input: {
  id?: string
  name: string
  model: string
  endpoint: string
  format: ChatApiFormat
  apiKey: string
  vision: boolean
  reasoning: boolean
  search: boolean
  headers?: Record<string, string>
}): ModelPreset => {
  const now = Date.now()
  const existing = input.id ? get().presets.find((item) => item.id === input.id) : undefined
  const preset: ModelPreset = {
    id: existing?.id ?? `model-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    model: input.model,
    endpoint: input.endpoint,
    format: input.format,
    apiKey: input.endpoint === '' ? '' : input.apiKey,
    vision: input.vision || input.endpoint === '',
    reasoning: input.reasoning || input.endpoint === '',
    search: input.search || input.endpoint === '',
    headers: input.endpoint === '' ? undefined : input.headers,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  set((state) => ({
    presets: existing
      ? state.presets.map((item) => (item.id === preset.id ? preset : item))
      : [...state.presets, preset],
  }))
  void putModelPreset(preset)
  // 编辑的就是激活中的预设 → 立即生效
  if (existing?.id === get().activeId) {
    applyPreset(preset)
  }
  return preset
}

export const removePreset = (id: string) => {
  const { presets, activeId } = get()
  const next = presets.filter((item) => item.id !== id)
  set({ presets: next })
  void deleteModelPreset(id)
  // 删除的是激活中的预设 → 回退到第一个可用预设
  if (activeId === id) {
    const fallback = next[0]
    if (fallback) {
      activatePreset(fallback.id)
    } else {
      writeActiveId(null)
      set({ activeId: null })
    }
  }
}
