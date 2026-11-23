import { translate } from '../../i18n/index.js'
import { MEMORY_DIMENSIONS, type MemoryCard } from './types.js'
import { isMemoryEnabled, resolveCharacter, useCharacters } from './store.js'

/** 所有生成请求统一携带的助手身份说明（官方 DeepSeek 默认身份）。 */
export const DEFAULT_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 记忆块的总字符预算；超出后按更新时间从新到旧截断。 */
const MEMORY_BUDGET = 6000

const DIMENSION_LABEL_KEYS = {
  preference: 'memoryDimPreference',
  daily: 'memoryDimDaily',
  social: 'memoryDimSocial',
  experience: 'memoryDimExperience',
  goal: 'memoryDimGoal',
  communication: 'memoryDimCommunication',
  trait: 'memoryDimTrait',
  emotion: 'memoryDimEmotion',
} as const satisfies Record<MemoryCard['dimension'], string>

const dimensionLabel = (dimension: MemoryCard['dimension']) =>
  translate(DIMENSION_LABEL_KEYS[dimension])

const DIMENSION_ORDER = new Map(MEMORY_DIMENSIONS.map((dimension, index) => [dimension, index]))

/** 把启用的记忆卡按重要级/更新时间挑进预算，再按维度顺序整理成紧凑列表。 */
export const buildMemoryBlock = (cards: readonly MemoryCard[]): string => {
  const enabled = cards
    .filter(
      (card) =>
        card.enabled &&
        // IndexedDB 里的历史数据可能来自旧版本/损坏的角色卡，渲染前再兜一次底。
        typeof card.content === 'string' &&
        card.content.trim().length > 0 &&
        DIMENSION_ORDER.has(card.dimension)
    )
    .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
  if (enabled.length === 0) {
    return ''
  }
  // 先按全局优先级决定谁能进预算，避免低优先级维度把高优先级卡片挤出预算。
  const selected: { dimension: MemoryCard['dimension']; line: string }[] = []
  let used = 0
  for (const card of enabled) {
    const line = `- [${dimensionLabel(card.dimension)}] ${card.content.trim()}`
    if (used + line.length > MEMORY_BUDGET) {
      continue
    }
    selected.push({ dimension: card.dimension, line })
    used += line.length
  }
  if (selected.length === 0) {
    return ''
  }
  // 入选后按维度分组，保持阅读顺序稳定（同维度内仍是重要级优先）。
  selected.sort(
    (a, b) => (DIMENSION_ORDER.get(a.dimension) ?? 0) - (DIMENSION_ORDER.get(b.dimension) ?? 0)
  )
  return `以下是关于用户的长期记忆，供你自然地参考，不要逐条复述：\n${selected
    .map((item) => item.line)
    .join('\n')}`
}

/**
 * 组装请求的 system 提示词：
 * - 官方 DeepSeek：保持官方身份说明 +（启用时）记忆块；
 * - 自定义角色：角色人设替换官方身份 +（启用时）记忆块；
 * - 自定义端点不走本函数（调用方直接传空串）。
 */
export const buildRequestSystem = (characterId: string | null | undefined): string => {
  const character = resolveCharacter(characterId)
  const base = character?.prompt.trim() ? character.prompt.trim() : DEFAULT_SYSTEM_PROMPT
  const memoryOn = isMemoryEnabled(characterId)
  const memoryBlock = memoryOn
    ? buildMemoryBlock(useCharacters.getState().memories[character?.id ?? 'default'] ?? [])
    : ''
  return memoryBlock ? `${base}\n\n${memoryBlock}` : base
}
