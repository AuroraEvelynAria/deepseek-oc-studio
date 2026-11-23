import { create } from 'zustand'
import * as db from './db.js'
import type { Character, MemoryCard } from './types.js'
const SELECTED_KEY = 'replica:selected-character'
const DEFAULT_MEMORY_KEY = 'replica:default-memory'

const readId = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeId = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时仅影响下次启动的默认选择
  }
}

type CharactersState = {
  ready: boolean
  characters: Character[]
  /** 按角色分组的记忆缓存；默认角色的键为 `default`。 */
  memories: Record<string, MemoryCard[]>
  /** 官方 DeepSeek（默认角色）的记忆开关。 */
  defaultMemoryEnabled: boolean
  /** 新对话默认使用的角色；null 表示官方 DeepSeek。 */
  selectedCharacterId: string | null
}

export const useCharacters = create<CharactersState>(() => ({
  ready: false,
  characters: [],
  memories: {},
  defaultMemoryEnabled: readId(DEFAULT_MEMORY_KEY) === 'true',
  selectedCharacterId: readId(SELECTED_KEY),
}))

const { getState: get, setState: set } = useCharacters

let initTask: Promise<void> | undefined

/** 启动时加载一次角色与全部记忆；记忆量级为个人本地数据，直接整库缓存换取注入时的同步读取。 */
export const initCharacters = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  initTask ??= (async () => {
    const [characters, memories] = await Promise.all([db.loadCharacters(), db.loadAllMemories()])
    // 选中的角色被删除后回退官方 DeepSeek。
    const selected = get().selectedCharacterId
    const valid = selected !== null && characters.some((item) => item.id === selected)
    if (selected !== null && !valid) {
      writeId(SELECTED_KEY, null)
    }
    set({
      ready: true,
      characters,
      memories,
      selectedCharacterId: valid ? selected : null,
    })
  })()
  return initTask
}

/** 解析会话绑定的角色；undefined/null/已删除的 id 都回退官方 DeepSeek（返回 null）。 */
export const resolveCharacter = (characterId: string | null | undefined): Character | null =>
  characterId ? (get().characters.find((item) => item.id === characterId) ?? null) : null

/** 会话实际生效的记忆开关：默认角色看全局开关，自定义角色看卡片开关。 */
export const isMemoryEnabled = (characterId: string | null | undefined): boolean =>
  characterId
    ? (resolveCharacter(characterId)?.memoryEnabled ?? false)
    : get().defaultMemoryEnabled

export const saveCharacter = (input: {
  id?: string
  name: string
  avatar: string | null
  prompt: string
  memoryEnabled?: boolean
}): Character => {
  const now = Date.now()
  const existing = input.id ? resolveCharacter(input.id) : undefined
  const character: Character = {
    id: existing?.id ?? `char-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    avatar: input.avatar,
    prompt: input.prompt,
    memoryEnabled: input.memoryEnabled ?? existing?.memoryEnabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  set((state) => {
    const characters = existing
      ? state.characters.map((item) => (item.id === character.id ? character : item))
      : [...state.characters, character]
    return { characters }
  })
  void db.putCharacter(character)
  return character
}

export const removeCharacter = (id: string) => {
  set((state) => {
    const memories = Object.fromEntries(
      Object.entries(state.memories).filter(([key]) => key !== id)
    )
    return {
      characters: state.characters.filter((item) => item.id !== id),
      memories,
      // 删除的是新对话默认角色时回退官方 DeepSeek
      selectedCharacterId: state.selectedCharacterId === id ? null : state.selectedCharacterId,
    }
  })
  void db.deleteCharacter(id)
}

export const setMemoryEnabled = (characterId: string | null, enabled: boolean) => {
  if (characterId === null) {
    writeId(DEFAULT_MEMORY_KEY, String(enabled))
    set({ defaultMemoryEnabled: enabled })
    return
  }
  const character = resolveCharacter(characterId)
  if (!character) {
    return
  }
  saveCharacter({ ...character, memoryEnabled: enabled })
}

/** 设置新对话的默认角色；null 或无效 id 都回退官方 DeepSeek。 */
export const setSelectedCharacter = (characterId: string | null) => {
  const valid =
    characterId && get().characters.some((item) => item.id === characterId) ? characterId : null
  writeId(SELECTED_KEY, valid)
  set({ selectedCharacterId: valid })
}

export const upsertMemory = (card: MemoryCard) => {
  set((state) => {
    const list = state.memories[card.characterId] ?? []
    const exists = list.some((item) => item.id === card.id)
    const memories = {
      ...state.memories,
      [card.characterId]: exists
        ? list.map((item) => (item.id === card.id ? card : item))
        : [...list, card],
    }
    return { memories }
  })
  void db.putMemory(card)
}

export const removeMemory = (characterId: string, id: string) => {
  set((state) => ({
    memories: {
      ...state.memories,
      [characterId]: (state.memories[characterId] ?? []).filter((item) => item.id !== id),
    },
  }))
  void db.deleteMemory(id)
}
