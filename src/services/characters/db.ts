import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Character, MemoryCard } from './types.js'

/**
 * 角色与记忆的独立 IndexedDB。
 * 与会话历史库（`chat-demo`）分开：新增功能不触碰历史库的版本升级路径，
 * 历史的导入、合并、清除也永远不会动到角色与记忆。
 */
const DB_NAME = 'replica'
const DB_VERSION = 2

interface ReplicaDB extends DBSchema {
  characters: { key: string; value: Character }
  memories: {
    key: string
    value: MemoryCard
    indexes: { characterId: string; byDimension: [string, string] }
  }
  models: { key: string; value: Record<string, unknown> & { id: string } }
}

let dbPromise: Promise<IDBPDatabase<ReplicaDB>> | null = null

const getDB = () => {
  const opening =
    dbPromise ??
    (dbPromise = openDB<ReplicaDB>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains('characters')) {
          db.createObjectStore('characters', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('memories')) {
          const memories = db.createObjectStore('memories', { keyPath: 'id' })
          memories.createIndex('characterId', 'characterId')
          memories.createIndex('byDimension', ['characterId', 'dimension'])
        }
        if (!db.objectStoreNames.contains('models')) {
          // 模型预设；value 结构由调用方保证（ModelPreset），这里只按 id 存取。
          void tx
          db.createObjectStore('models', { keyPath: 'id' })
        }
      },
      blocking() {
        // 新版本打开时让出旧连接，下次操作自动重开。
        void opening.then((db) => db.close()).catch(() => {})
        dbPromise = null
      },
    }))
  return opening
}

/** 存储失败只上报控制台：角色与记忆是附加能力，不应打断聊天主流程。 */
const report = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[characters] ${action} failed`, error)
}

export const loadCharacters = async (): Promise<Character[]> => {
  try {
    return (await (await getDB()).getAll('characters')).sort((a, b) => a.createdAt - b.createdAt)
  } catch (error) {
    report('load characters')(error)
    return []
  }
}

export const putCharacter = (character: Character): Promise<void> =>
  (async () => {
    await (await getDB()).put('characters', character)
  })().catch(report('save character'))

export const deleteCharacter = async (id: string): Promise<void> => {
  try {
    const db = await getDB()
    const cards = await db.getAllFromIndex('memories', 'characterId', id)
    await Promise.all([
      db.delete('characters', id),
      ...cards.map((card) => db.delete('memories', card.id)),
    ])
  } catch (error) {
    report('delete character')(error)
  }
}

export const loadMemories = async (characterId: string): Promise<MemoryCard[]> => {
  try {
    return await (await getDB()).getAllFromIndex('memories', 'characterId', characterId)
  } catch (error) {
    report('load memories')(error)
    return []
  }
}

export const loadAllMemories = async (): Promise<Record<string, MemoryCard[]>> => {
  try {
    const all = await (await getDB()).getAll('memories')
    const grouped: Record<string, MemoryCard[]> = {}
    for (const card of all) {
      ;(grouped[card.characterId] ??= []).push(card)
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => a.createdAt - b.createdAt)
    }
    return grouped
  } catch (error) {
    report('load all memories')(error)
    return {}
  }
}

export const putMemory = (card: MemoryCard): Promise<void> =>
  (async () => {
    await (await getDB()).put('memories', card)
  })().catch(report('save memory'))

export const deleteMemory = (id: string): Promise<void> =>
  (async () => {
    await (await getDB()).delete('memories', id)
  })().catch(report('delete memory'))

// ---- 模型预设 ----

export const loadModelPresets = async <T extends { id: string }>(): Promise<T[]> => {
  try {
    return (await (await getDB()).getAll('models')) as T[]
  } catch (error) {
    report('load model presets')(error)
    return []
  }
}

export const putModelPreset = <T extends { id: string }>(preset: T): Promise<void> =>
  (async () => {
    await (await getDB()).put('models', preset)
  })().catch(report('save model preset'))

export const deleteModelPreset = (id: string): Promise<void> =>
  (async () => {
    await (await getDB()).delete('models', id)
  })().catch(report('delete model preset'))
