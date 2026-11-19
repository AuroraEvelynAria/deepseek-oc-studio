import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { createId } from '../../utils/id.js'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 13

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

type HistoryState = { slot: 'primary' | 'alternate'; importId?: string }
type RetiredHistory = { slot: HistoryState['slot']; importId: string }

const slots = {
  primary: { sessions: 'sessions', summaries: 'sessionSummaries', files: 'files' },
  alternate: {
    sessions: 'sessionsStaging',
    summaries: 'sessionSummariesStaging',
    files: 'filesStaging',
  },
} as const

const historyStores = [
  'historyState',
  'historyCleanup',
  'sessions',
  'sessionSummaries',
  'files',
  'sessionsStaging',
  'sessionSummariesStaging',
  'filesStaging',
] as const

type HistoryStore = (typeof historyStores)[number]

type HistoryTransaction<Mode extends 'readonly' | 'readwrite'> = IDBPTransaction<
  ChatDB,
  readonly HistoryStore[],
  Mode
>

interface ChatDB extends DBSchema {
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  files: { key: string; value: StoredFile }
  sessionsStaging: { key: string; value: Session }
  sessionSummariesStaging: ChatDB['sessionSummaries']
  filesStaging: { key: string; value: StoredFile }
  historyState: { key: 'active'; value: HistoryState }
  historyCleanup: { key: 'retired'; value: RetiredHistory }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

const storedSummary = (session: Session): StoredSessionSummary => {
  const fileIds = new Set<string>()
  for (const message of session.messages) {
    if (message.role === 'user') {
      for (const file of message.files) {
        fileIds.add(file.id)
      }
    }
  }
  return { ...toSessionSummary(session), fileIds: [...fileIds] }
}

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 现有历史继续使用原来的存储，只有完成一次导入后才切换。
      for (const name of ['sessions', 'files', 'sessionsStaging', 'filesStaging'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      for (const { summaries: name } of Object.values(slots)) {
        const summaries = db.objectStoreNames.contains(name)
          ? tx.objectStore(name)
          : db.createObjectStore(name, { keyPath: 'id' })
        if (!summaries.indexNames.contains('fileIds')) {
          summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
        }
      }
      if (!db.objectStoreNames.contains('historyState')) {
        db.createObjectStore('historyState')
      }
      if (!db.objectStoreNames.contains('historyCleanup')) {
        db.createObjectStore('historyCleanup')
      }
    },
    blocking() {
      void dbPromise?.then((db) => db.close())
      dbPromise = null
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

const transact = async <Mode extends 'readonly' | 'readwrite', Result>(
  scope: readonly HistoryStore[],
  mode: Mode,
  run: (tx: HistoryTransaction<Mode>) => Promise<Result>
): Promise<Result> => {
  const tx = (await getDB()).transaction(scope, mode)
  const [result] = await Promise.all([
    (async () => {
      try {
        return await run(tx)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  return result
}

type HistoryOperation<Mode extends 'readonly' | 'readwrite', Result> = (
  tx: HistoryTransaction<Mode>,
  state: HistoryState
) => Promise<Result>

const withHistory = <Mode extends 'readonly' | 'readwrite', Result>(
  mode: Mode,
  run: HistoryOperation<Mode, Result>,
  scope: readonly HistoryStore[] = historyStores
) =>
  transact(scope, mode, async (tx) => {
    const state = await tx.objectStore('historyState').get('active')
    return run(tx, state ?? { slot: 'primary' })
  })

let preferredSlot: HistoryState['slot'] = 'primary'

// 普通读写只锁当前使用的一组存储。每次在同一事务内核对指针，换库后按新指针重试。
const withActive = async <Mode extends 'readonly' | 'readwrite', Result>(
  mode: Mode,
  run: HistoryOperation<Mode, Result>
): Promise<Result> => {
  for (;;) {
    const expected = preferredSlot
    const attempt = await withHistory(
      mode,
      async (tx, state) =>
        state.slot === expected
          ? { match: true as const, value: await run(tx, state) }
          : { match: false as const, slot: state.slot },
      ['historyState', ...Object.values(slots[expected])]
    )
    if (attempt.match) {
      return attempt.value
    }
    preferredSlot = attempt.slot
  }
}

export const loadSessionSummaries = async (): Promise<SessionSummary[]> => {
  const summaries = await withActive('readonly', (tx, { slot }) =>
    tx.objectStore(slots[slot].summaries).getAll()
  )
  scheduleRetiredCleanup()
  return summaries.map(toSessionSummary)
}

export const loadSession = (id: string): Promise<Session | undefined> =>
  withActive('readonly', (tx, { slot }) => tx.objectStore(slots[slot].sessions).get(id))

export const saveSession = (session: Session, files: StoredFile[] = []): Promise<void> =>
  withActive('readwrite', async (tx, { slot }) => {
    const stores = slots[slot]
    const summary = storedSummary(session)
    await Promise.all([
      ...files.map((file) => tx.objectStore(stores.files).put(file)),
      tx.objectStore(stores.sessions).put(session),
      tx.objectStore(stores.summaries).put(summary),
    ])
  })

/** 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。 */
export const renameSession = (id: string, title: string): Promise<void> =>
  withActive('readwrite', async (tx, { slot }) => {
    const sessions = tx.objectStore(slots[slot].sessions)
    const session = await sessions.get(id)
    if (session) {
      session.title = title
      await Promise.all([
        sessions.put(session),
        tx.objectStore(slots[slot].summaries).put(storedSummary(session)),
      ])
    }
  })

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = (sessionId: string): Promise<void> =>
  withActive('readwrite', async (tx, { slot }) => {
    const stores = slots[slot]
    const summaries = tx.objectStore(stores.summaries)
    const summary = await summaries.get(sessionId)
    await Promise.all([
      tx.objectStore(stores.sessions).delete(sessionId),
      summaries.delete(sessionId),
    ])
    for (const id of summary?.fileIds ?? []) {
      if ((await summaries.index('fileIds').count(id)) === 0) {
        await tx.objectStore(stores.files).delete(id)
      }
    }
  })

export const saveFiles = (files: StoredFile[]): Promise<void> =>
  withActive('readwrite', async (tx, { slot }) => {
    const store = tx.objectStore(slots[slot].files)
    await Promise.all(files.map((file) => store.put(file)))
  })

export const loadFile = (id: string): Promise<Blob | undefined> =>
  withActive(
    'readonly',
    async (tx, { slot }) => (await tx.objectStore(slots[slot].files).get(id))?.blob
  )

const inactiveSlot = (slot: HistoryState['slot']) => (slot === 'primary' ? 'alternate' : 'primary')

const clearSlot = (tx: HistoryTransaction<'readwrite'>, slot: HistoryState['slot']) =>
  Promise.all(Object.values(slots[slot]).map((name) => tx.objectStore(name).clear()))

const setHistoryState = (tx: HistoryTransaction<'readwrite'>, state: HistoryState) =>
  tx.objectStore('historyState').put(state, 'active')

const CLEANUP_BATCH_SIZE = 256
let cleanupQueue = Promise.resolve()

const clearRetiredHistory = async () => {
  const retired = await (await getDB()).get('historyCleanup', 'retired')
  if (!retired) {
    return
  }
  const names = Object.values(slots[retired.slot])
  let more = true
  while (more) {
    // 分批清理旧数据，给正在使用的 IndexedDB 事务让出执行机会。
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    more = await transact(['historyCleanup', ...names], 'readwrite', async (tx) => {
      const cleanup = tx.objectStore('historyCleanup')
      const pending = await cleanup.get('retired')
      if (pending?.importId !== retired.importId) {
        return false
      }
      const remaining = await Promise.all(
        names.map(async (name) => {
          const store = tx.objectStore(name)
          const keys = await store.getAllKeys(null, CLEANUP_BATCH_SIZE)
          const last = keys.at(-1)
          if (last !== undefined) {
            await store.delete(IDBKeyRange.upperBound(last))
          }
          return keys.length === CLEANUP_BATCH_SIZE
        })
      )
      if (!remaining.some(Boolean)) {
        await cleanup.delete('retired')
        return false
      }
      return true
    })
  }
}

const scheduleRetiredCleanup = () => {
  cleanupQueue = cleanupQueue
    .then(clearRetiredHistory)
    .catch(reportStorageError('clear replaced history'))
}

// 导入线程只持有标识。每次写入都在事务内核对标识，防止过期任务写入新的暂存区。
const withStaging = <Result>(
  importId: string,
  run: (tx: HistoryTransaction<'readwrite'>, slot: HistoryState['slot']) => Promise<Result>
) =>
  withHistory('readwrite', (tx, state) => {
    if (state.importId !== importId) {
      throw new Error('History import was replaced by another import')
    }
    return run(tx, state.slot)
  })

export const stagingWriter = (importId: string) => {
  const summaries: SessionSummary[] = []
  return {
    summaries,
    async addSessions(sessions: Session[]) {
      const batch = sessions.map(storedSummary)
      await withStaging(importId, async (tx, slot) => {
        const stores = slots[inactiveSlot(slot)]
        const details = tx.objectStore(stores.sessions)
        const index = tx.objectStore(stores.summaries)
        await Promise.all([
          ...sessions.map((session) => details.add(session)),
          ...batch.map((summary) => index.add(summary)),
        ])
      })
      for (const summary of batch) {
        summaries.push(toSessionSummary(summary))
      }
    },
    async addFiles(files: StoredFile[]) {
      await withStaging(importId, async (tx, slot) => {
        const store = tx.objectStore(slots[inactiveSlot(slot)].files)
        await Promise.all(files.map((file) => store.put(file)))
      })
    },
    async updateFileTypes(ids: string[], types: ReadonlyMap<string, string>) {
      await withStaging(importId, async (tx, slot) => {
        const store = tx.objectStore(slots[inactiveSlot(slot)].sessions)
        await Promise.all(
          ids.map(async (id) => {
            const session = await store.get(id)
            if (!session) {
              throw new Error(`Staged session disappeared: ${id}`)
            }
            let changed = false
            for (const message of session.messages) {
              if (message.role !== 'user') {
                continue
              }
              for (const file of message.files) {
                const type = types.get(file.id) ?? ''
                if (file.mimeType !== type) {
                  file.mimeType = type
                  changed = true
                }
              }
            }
            if (changed) {
              await store.put(session)
            }
          })
        )
      })
    },
  }
}

/** 两组存储轮流使用，界面线程拥有提交和清理权限。 */
export const beginStaging = async () => {
  const importId = createId()
  await withHistory('readwrite', async (tx, { slot }) => {
    await clearSlot(tx, inactiveSlot(slot))
    await tx.objectStore('historyCleanup').delete('retired')
    await setHistoryState(tx, { slot, importId })
  })
  return {
    importId,
    async commit(clearInBackground: boolean) {
      preferredSlot = await withStaging(importId, async (tx, slot) => {
        const next = inactiveSlot(slot)
        if (clearInBackground) {
          await tx.objectStore('historyCleanup').put({ slot, importId }, 'retired')
        } else {
          await clearSlot(tx, slot)
        }
        await setHistoryState(tx, { slot: next })
        return next
      })
      if (clearInBackground) {
        scheduleRetiredCleanup()
      }
    },
    async discard() {
      await withHistory('readwrite', async (tx, state) => {
        if (state.importId === importId) {
          await clearSlot(tx, inactiveSlot(state.slot))
          await setHistoryState(tx, { slot: state.slot })
        }
      })
    },
  }
}

export type HistoryStaging = Awaited<ReturnType<typeof beginStaging>>

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}
