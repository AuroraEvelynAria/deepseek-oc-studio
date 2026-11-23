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

/** 把启用的记忆卡按固定维度顺序拼成紧凑列表；重要卡优先，超预算时低优先级让位。 */
export const buildMemoryBlock = (cards: readonly MemoryCard[]): string => {
  const enabled = cards
    .filter((card) => card.enabled && card.content.trim())
    .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
  if (enabled.length === 0) {
    return ''
  }
  const lines: string[] = []
  let used = 0
  for (const dimension of MEMORY_DIMENSIONS) {
    for (const card of enabled) {
      if (card.dimension !== dimension) {
        continue
      }
      const line = `- [${dimensionLabel(dimension)}] ${card.content.trim()}`
      if (used + line.length > MEMORY_BUDGET) {
        continue
      }
      lines.push(line)
      used += line.length
    }
  }
  if (lines.length === 0) {
    return ''
  }
  return `以下是关于用户的长期记忆，供你自然地参考，不要逐条复述：\n${lines.join('\n')}`
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
