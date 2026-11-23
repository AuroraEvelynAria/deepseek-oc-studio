import { debugLog } from '../debug/log.js'
import { useSettings } from '../settings.js'

/**
 * 形象工作室：为角色生成形象（借鉴 nanoMuse 的 AvatarStudio 流程）。
 * 一次描述 → N 个候选（同一角色不同设计变体）→ 选一张定妆（设为头像）→
 * （可选）基于定妆图衍生表情包。图像 API 当前使用硅基流动（OpenAI 兼容
 * images/generations 端点），凭据来自激活的模型预设的 Key。
 */

const GENERATIONS_URL = 'https://api.siliconflow.cn/v1/images/generations'

/** 每次生成的候选数（nanoMuse 同款四宫格）。 */
export const AVATAR_CANDIDATES = 4

/** 风格咒语：打磨好的英文风格短语，OC 用户不懂写 prompt 也能出好图。 */
export type AvatarStyle = {
  id: string
  labelKey: 'avatarStyleMuse' | 'avatarStyleFlat' | 'avatarStyleClay' | 'avatarStyleWatercolor' | 'avatarStylePixel' | 'avatarStyleLine' | 'avatarStyleSticker'
  phrase: string
}

export const AVATAR_STYLES: AvatarStyle[] = [
  {
    id: 'muse',
    labelKey: 'avatarStyleMuse',
    phrase:
      'cute 3D character render in the style of a collectible vinyl toy, soft matte materials with subtle sheen, rounded simplified forms, big friendly eyes, soft studio lighting with gentle shadows, pastel accents',
  },
  {
    id: 'flat',
    labelKey: 'avatarStyleFlat',
    phrase: 'flat vector illustration, soft pastel colours, clean simple shapes, subtle shading',
  },
  {
    id: 'clay',
    labelKey: 'avatarStyleClay',
    phrase: '3D clay render, soft studio lighting, matte rounded forms, gentle colours',
  },
  {
    id: 'watercolor',
    labelKey: 'avatarStyleWatercolor',
    phrase: 'gentle watercolour painting, soft edges, light paper texture',
  },
  {
    id: 'pixel',
    labelKey: 'avatarStylePixel',
    phrase: 'crisp pixel art, limited palette, clean silhouette',
  },
  {
    id: 'line',
    labelKey: 'avatarStyleLine',
    phrase: 'minimal line drawing with two accent colours on cream, confident strokes',
  },
  {
    id: 'sticker',
    labelKey: 'avatarStyleSticker',
    phrase: 'glossy sticker style, thick white outline, bold saturated colours',
  },
]

/** 四个设计变体：同一角色的不同设计方向（nanoMuse 同款思路，改成 OC 术语）。 */
const VARIATIONS = [
  'variation 1: the most typical, classic design of the character',
  'variation 2: a lighter-coloured variant of the same character, softer palette',
  'variation 3: a darker or warmer variant, with one small accessory such as a scarf, glasses or earrings',
  'variation 4: a playful take — unusual colour accents, a slight head tilt, one signature prop',
]

/** 组装单张候选的 prompt（nanoMuse buildPrompt 的 OC 版）。 */
const buildCandidatePrompt = (description: string, style: AvatarStyle, index: number): string => {
  const subject = description.trim().replace(/[.。!！,，]+$/, '')
  const variation = VARIATIONS[index % VARIATIONS.length]
  return (
    `A single character based on: ${subject}. ${style.phrase}. ` +
    'Full body, standing, facing the viewer, centred, whole figure visible with margin on all sides, ' +
    'expressive face, friendly mood, pure white background, soft ground shadow only. ' +
    `${variation}. Square composition. No text, no watermark, no border, one character only.`
  )
}

export type AvatarSlot =
  | { state: 'empty' }
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'failed'; message: string }

type StudioState = {
  slots: AvatarSlot[]
  description: string
  styleId: string
  generating: boolean
}

type Listener = () => void

/** 轻量 store（避免引入额外 zustand 依赖模式不一致——沿用 zustand 即可）。 */
import { create } from 'zustand'
export const useAvatarStudio = create<StudioState>(() => ({
  slots: Array.from({ length: AVATAR_CANDIDATES }, () => ({ state: 'empty' })),
  description: '',
  styleId: AVATAR_STYLES[0].id,
  generating: false,
}))

const setSlots = (updater: (slots: AvatarSlot[]) => AvatarSlot[]) =>
  useAvatarStudio.setState((state) => ({ slots: updater(state.slots) }))

const listeners = new Set<Listener>()
export const onStudioEvent = (listener: Listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const emit = () => listeners.forEach((listener) => listener())

/** 当前激活预设的 Key 是否能调图像 API（仅硅基流动端点直接复用其 Key）。 */
export const isImageGenAvailable = (): boolean => Boolean(resolveSiliconflowKey())

const resolveSiliconflowKey = (): string | null => {
  const { chatConfig } = useSettings.getState()
  // 允许用户在任意预设的「自定义请求头」里填过 siliconflow key 的情况先不考虑；
  // 主路径：端点是硅基流动 → 直接用其 Key；否则提示用户到硅基流动申请
  if (chatConfig.endpoint.includes('siliconflow.cn')) {
    return chatConfig.apiKey || null
  }
  return null
}

const extractImageUrl = (payload: unknown): string | null => {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  const data = (payload as { data?: unknown }).data
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as { url?: unknown; b64_json?: unknown }
    if (typeof first.url === 'string') {
      return first.url
    }
    if (typeof first.b64_json === 'string') {
      return `data:image/png;base64,${first.b64_json}`
    }
  }
  return null
}

const drawOne = async (
  prompt: string,
  index: number,
  signal: AbortSignal
): Promise<void> => {
  const key = resolveSiliconflowKey()
  if (!key) {
    setSlots((slots) => slots.map((slot, i) => (i === index ? { state: 'failed', message: 'no-key' } : slot)))
    return
  }
  try {
    const response = await fetch(GENERATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'Kolors',
        prompt,
        image_size: '1024x1024',
      }),
      signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      // 限流退避重试一次
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 4000))
        return drawOne(prompt, index, signal)
      }
      throw new Error(`HTTP ${response.status} ${text.slice(0, 120)}`)
    }
    const payload: unknown = await response.json()
    const url = extractImageUrl(payload)
    if (!url) {
      throw new Error('no image in response')
    }
    setSlots((slots) => slots.map((slot, i) => (i === index ? { state: 'ready', url } : slot)))
  } catch (error) {
    if (signal.aborted) {
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    setSlots((slots) => slots.map((slot, i) => (i === index ? { state: 'failed', message } : slot)))
  }
}

/** 生成 N 个候选（不阻塞 UI，格子逐个就位）。 */
export const generateCandidates = (description: string, styleId: string): boolean => {
  const key = resolveSiliconflowKey()
  if (!key) {
    debugLog('event', '形象生成不可用 · 当前激活预设不是硅基流动（图像 API 需要）')
    return false
  }
  const style = AVATAR_STYLES.find((item) => item.id === styleId) ?? AVATAR_STYLES[0]
  useAvatarStudio.setState({
    description,
    styleId: style.id,
    generating: true,
    slots: Array.from({ length: AVATAR_CANDIDATES }, () => ({ state: 'loading' })),
  })
  emit()
  const controller = new AbortController()
  Promise.all(
    Array.from({ length: AVATAR_CANDIDATES }, (_, index) => {
      const prompt = buildCandidatePrompt(description, style, index)
      return drawOne(prompt, index, controller.signal)
    })
  ).then(() => {
    useAvatarStudio.setState({ generating: false })
    emit()
  })
  debugLog('state', `形象生成启动 · ${style.id} · ${description.slice(0, 60)}`)
  return true
}

/** 定妆：把选中的候选图设为角色头像（经 canvas 居中裁剪，与手动上传同管线）。 */
export const adoptCandidate = async (
  url: string,
  applyAvatar: (dataUrl: string) => void
): Promise<void> => {
  const response = await fetch(url)
  const blob = await response.blob()
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('image decode failed'))
    image.src = URL.createObjectURL(blob)
  })
  const crop = Math.min(image.naturalWidth, image.naturalHeight)
  const edge = Math.min(crop, 256)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = edge
  const context = canvas.getContext('2d')
  if (!context || edge === 0) {
    throw new Error('canvas unavailable')
  }
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    (image.naturalWidth - crop) / 2,
    (image.naturalHeight - crop) / 2,
    crop,
    crop,
    0,
    0,
    edge,
    edge
  )
  applyAvatar(canvas.toDataURL('image/webp', 0.85))
  debugLog('state', '形象定妆 · 已设为角色头像')
}
