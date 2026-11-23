import { readBlobBuffer } from '../../utils/blob.js'
import { updateCrc } from '../chat/history/zipReader.js'
import {
  isMemoryDimension,
  MEMORY_CONTENT_LIMIT,
  type Character,
  type MemoryCard,
} from './types.js'

/**
 * 角色卡编解码：SillyTavern PNG 角色卡（tEXt chunk）互通 + `replica.persona` 自家卡。
 *
 * 遵循 Muse 的角色卡安全设计：
 * - 卡里只有人设本身——API Key、模型绑定、会话内容没有字段可放；
 * - 导入严格解析：未知字段忽略但关键字段缺失/类型不符直接拒绝，不悄悄降级；
 * - 超限拒绝而不截断（截断会静默改变人设），导入路径用更宽的上限只挡极端体积。
 */

export class CardError extends Error {
  constructor(readonly reason: 'notPng' | 'noCard' | 'invalidCard' | 'tooLarge' | 'invalidPersona') {
    super(`character card error: ${reason}`)
    this.name = 'CardError'
  }
}

/** SillyTavern 角色卡 v2 结构（本项目消费的字段 + 保留字段）。 */
export type StCardV2 = {
  spec?: string
  spec_version?: string
  name?: string
  description?: string
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  data?: Partial<StCardV2>
  [key: string]: unknown
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const TEXT_CHUNK = 0x74455874 // tEXt
const IEND = 0x49454e44

/** 常规导入的文本上限；超出视为损坏而非截断（Muse 规则）。 */
const MAX_CARD_CHARS = 200_000
/** replica.persona 记忆条数上限（只挡极端体积）。 */
const MAX_MEMORY_CARDS = 2000

const decodeLatin1 = (bytes: Uint8Array) => {
  let text = ''
  for (let index = 0; index < bytes.length; index++) {
    text += String.fromCharCode(bytes[index])
  }
  return text
}

/** tEXt 的载荷是 base64(UTF-8 JSON)；必须按 UTF-8 解码，按字节展开会把中文/emoji 变成乱码。 */
const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const encodeLatin1 = (text: string) => {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) {
    bytes[index] = text.charCodeAt(index) & 0xff
  }
  return bytes
}

const crc32 = (data: Uint8Array) => updateCrc(0xffffffff, data) ^ 0xffffffff

/** 组装一个完整的 PNG chunk：[长度][类型][数据][CRC]。 */
const buildChunk = (type: string, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length, false)
  const typeBytes = encodeLatin1(type)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  // CRC 覆盖类型 + 数据
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput), false)
  return chunk
}

/** 从 PNG 字节里读出所有 tEXt 的 keyword/text（tEXt 只按规范用 Latin-1 读，载荷再单独解码）。 */
const readTextChunks = (bytes: Uint8Array): Map<string, string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const texts = new Map<string, string>()
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false)
    const type = view.getUint32(offset + 4, false)
    if (type === IEND) {
      break
    }
    // 越界说明文件损坏，停止扫描而不是把截断数据当正文。
    if (offset + 12 + length > bytes.length) {
      break
    }
    if (type === TEXT_CHUNK) {
      const data = bytes.subarray(offset + 8, offset + 8 + length)
      const raw = decodeLatin1(data)
      const separator = raw.indexOf('\0')
      if (separator > 0) {
        texts.set(raw.slice(0, separator), raw.slice(separator + 1))
      }
    }
    offset += 12 + length
  }
  return texts
}

/** 解析 SillyTavern v2 卡 JSON：严格校验关键字段，不宽容降级。 */
export const parseStCard = (raw: string): StCardV2 => {
  if (raw.length > MAX_CARD_CHARS * 4) {
    throw new CardError('tooLarge')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CardError('invalidCard')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new CardError('invalidCard')
  }
  const card = parsed as StCardV2
  const data = (typeof card.data === 'object' && card.data !== null ? card.data : card) as StCardV2
  if (typeof data.name !== 'string' || !data.name.trim()) {
    throw new CardError('invalidCard')
  }
  if (typeof data.description !== 'string') {
    throw new CardError('invalidCard')
  }
  return card
}

/** 读取 PNG 角色卡：返回卡对象与图片 Blob（作头像用）。 */
export const readCharacterCardFromPng = async (file: Blob): Promise<{ card: StCardV2; image: Blob }> => {
  // 角色卡头像最终会被裁成 256px；超过 32MB 的 PNG 只可能是异常文件，先挡住避免移动端 OOM。
  if (file.size > 32 * 1024 * 1024) {
    throw new CardError('tooLarge')
  }
  const bytes = new Uint8Array(await readBlobBuffer(file))
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new CardError('notPng')
  }
  const texts = readTextChunks(bytes)
  // chara 是 v2 约定；ccv3 是 v3 扩展，都扫
  const encoded = texts.get('chara') ?? texts.get('ccv3')
  if (!encoded) {
    throw new CardError('noCard')
  }
  const card = parseStCard(decodeUtf8(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))))
  return { card, image: file }
}

/** 把 dataURL 头像转成 PNG 字节（ST 卡载体必须是 PNG；webp 等先经 canvas 重编码）。 */
const avatarToPngBytes = (avatar: string): Promise<Uint8Array<ArrayBuffer> | null> =>
  new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(null)
        return
      }
      context.drawImage(image, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob || blob.type !== 'image/png') {
          resolve(null)
          return
        }
        void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer as ArrayBuffer)))
      }, 'image/png')
    }
    image.onerror = () => resolve(null)
    image.src = avatar
  })

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/** 把 ST 卡以 tEXt chunk 注入 PNG 载体（插在 IHDR 之后）。 */
export const writeCardToPngBytes = (pngBytes: Uint8Array<ArrayBuffer>, card: StCardV2): Blob => {
  const json = JSON.stringify(card)
  const encoded = encodeLatin1(toBase64(new TextEncoder().encode(json)))
  const keyword = encodeLatin1('chara\0')
  const textData = new Uint8Array(keyword.length + encoded.length)
  textData.set(keyword, 0)
  textData.set(encoded, keyword.length)
  const textChunk = buildChunk('tEXt', textData)

  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength)
  // 找 IHDR 结束位置（8 签名 + 12 头 + IHDR 长度）
  const ihdrLength = view.getUint32(8, false)
  const insertAt = 8 + 12 + ihdrLength
  const head = pngBytes.subarray(0, insertAt)
  const tail = pngBytes.subarray(insertAt)
  return new Blob([head, textChunk, tail], { type: 'image/png' })
}

/** 由 Character 生成 ST v2 卡 JSON（人设进 description，凭据不入卡）。 */
const buildStCard = (character: Character): StCardV2 => ({
  spec: 'chara_card_v2',
  spec_version: '2.0',
  name: character.name,
  description: character.prompt,
  personality: '',
  scenario: '',
  first_mes: '',
  data: {
    name: character.name,
    description: character.prompt,
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
  },
  // 本 app 扩展：记忆与元数据放 extensions，ST 会原样保留（round-trip 不丢）
  extensions: {
    'replica.character': {
      memoryEnabled: character.memoryEnabled,
      prompt: character.prompt,
    },
  },
})

/** 导出角色为 SillyTavern PNG 角色卡（头像为载体；无头像用 1x1 透明 PNG）。 */
export const exportCharacterAsPngCard = async (character: Character): Promise<Blob> => {
  let pngBytes: Uint8Array<ArrayBuffer> | null = null
  if (character.avatar) {
    pngBytes = await avatarToPngBytes(character.avatar)
  }
  if (!pngBytes) {
    pngBytes = buildMinimalPng()
  }
  return writeCardToPngBytes(pngBytes, buildStCard(character))
}

/** 1x1 透明 PNG（仅承载元数据的兜底载体）。 */
const buildMinimalPng = (): Uint8Array<ArrayBuffer> => {
  // 预生成的合法 1x1 透明 PNG（67 字节）
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]
  return Uint8Array.from(bytes)
}

// ---- replica.persona 自家卡 ----

export type ReplicaPersonaCard = {
  format: 'replica.persona'
  version: 1
  character: {
    name: string
    prompt: string
    avatar: string | null
    memoryEnabled: boolean
  }
  memories: MemoryCard[]
  /** ST 卡导入时保留的原始字段（round-trip） */
  extra?: unknown
}

const toPersonaCard = (character: Character, memories: readonly MemoryCard[]): ReplicaPersonaCard => ({
  format: 'replica.persona',
  version: 1,
  character: {
    name: character.name,
    prompt: character.prompt,
    avatar: character.avatar,
    memoryEnabled: character.memoryEnabled,
  },
  memories: memories.map((card) => ({
    ...card,
    characterId: '{characterId}',
    source: card.source ? { ...card.source, sessionId: '{sourceSession}' } : null,
  })),
})

export const exportPersonaJson = (character: Character, memories: readonly MemoryCard[]): Blob =>
  new Blob([JSON.stringify(toPersonaCard(character, memories), null, 2)], {
    type: 'application/json',
  })

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * 逐条校验记忆卡：persona 卡来自外部文件，任何一条结构不符都可能让记忆视图
 * 或记忆注入抛错（例如 dimension 非法 → translate(undefined)），因此严格拒绝。
 */
const validateMemories = (value: unknown): MemoryCard[] => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new CardError('invalidPersona')
  }
  if (value.length > MAX_MEMORY_CARDS) {
    throw new CardError('tooLarge')
  }
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      throw new CardError('invalidPersona')
    }
    const card = item as Partial<MemoryCard>
    if (
      !isMemoryDimension(card.dimension) ||
      typeof card.content !== 'string' ||
      !card.content.trim() ||
      card.content.length > MEMORY_CONTENT_LIMIT ||
      typeof card.enabled !== 'boolean' ||
      (card.importance !== 0 && card.importance !== 1 && card.importance !== 2) ||
      !isFiniteNumber(card.createdAt) ||
      !isFiniteNumber(card.updatedAt)
    ) {
      throw new CardError('invalidPersona')
    }
    const source = card.source
    if (source !== null && source !== undefined) {
      if (
        typeof source !== 'object' ||
        typeof source.sessionId !== 'string' ||
        (source.quote !== undefined && typeof source.quote !== 'string') ||
        (source.messageId !== undefined && typeof source.messageId !== 'string')
      ) {
        throw new CardError('invalidPersona')
      }
    }
    return card as MemoryCard
  })
}

/** 解析 replica.persona JSON：严格校验，关键字段缺失即拒。 */
export const parsePersonaCard = async (file: Blob): Promise<ReplicaPersonaCard> => {
  const text = await file.text()
  if (text.length > MAX_CARD_CHARS * 4) {
    throw new CardError('tooLarge')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CardError('invalidPersona')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new CardError('invalidPersona')
  }
  const card = parsed as Partial<ReplicaPersonaCard>
  if (card.format !== 'replica.persona' || card.version !== 1) {
    throw new CardError('invalidPersona')
  }
  const character = card.character
  if (
    typeof character !== 'object' ||
    character === null ||
    typeof character.name !== 'string' ||
    !character.name.trim() ||
    typeof character.prompt !== 'string' ||
    character.prompt.length > MAX_CARD_CHARS
  ) {
    throw new CardError('invalidPersona')
  }
  if (
    character.avatar !== undefined &&
    character.avatar !== null &&
    typeof character.avatar !== 'string'
  ) {
    throw new CardError('invalidPersona')
  }
  if (character.memoryEnabled !== undefined && typeof character.memoryEnabled !== 'boolean') {
    throw new CardError('invalidPersona')
  }
  return {
    format: 'replica.persona',
    version: 1,
    character: {
      name: character.name.trim(),
      prompt: character.prompt,
      avatar: character.avatar ?? null,
      memoryEnabled: character.memoryEnabled ?? true,
    },
    memories: validateMemories(card.memories),
    extra: card.extra,
  }
}

/** 按文件内容嗅探类型并解析（PNG 签名 → ST 卡；JSON → persona 卡）。 */
export const parseCharacterFile = async (
  file: Blob
): Promise<
  | { kind: 'st'; card: StCardV2; image: Blob }
  | { kind: 'persona'; card: ReplicaPersonaCard }
> => {
  const head = new Uint8Array(await readBlobBuffer(file.slice(0, 8)))
  if (PNG_SIGNATURE.every((byte, index) => head[index] === byte)) {
    const { card, image } = await readCharacterCardFromPng(file)
    return { kind: 'st', card, image }
  }
  return { kind: 'persona', card: await parsePersonaCard(file) }
}
