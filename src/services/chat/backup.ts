import { formatDate } from '../../utils/format.js'
import { translate, type TranslationMessage } from '../../i18n/index.js'
import * as db from './db.js'
import { replaceHistory, useChatStore } from './store.js'
import type { Session } from './types.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    async function* readSessions(): AsyncGenerator<Session> {
      for (const summary of sessions) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const blob = await exportArchive(readSessions())
    return { name: backupFileName(now), blob }
  })

/**
 * 确认覆盖后调用：流式校验 ZIP 并写入暂存，成功后才停止生成并替换原有历史。
 * 返回导入的会话数。
 */
export const importHistory = (
  file: File,
  onProgress?: (status: TranslationMessage) => void
): Promise<number> =>
  enqueueBackup(async () => {
    onProgress?.({ key: 'historyImporting' })
    const { importArchive } = await import('./history/importArchive.js')
    const started = performance.now()
    return replaceHistory(
      (staging) =>
        importArchive(file, staging, (progress) => {
          if (!onProgress) {
            return
          }
          if (!progress) {
            onProgress({ key: 'historyImportFinishing' })
            return
          }
          const { bytes, total, count } = progress
          const fraction = total > 0 ? bytes / total : 0
          const percent = Math.min(99, Math.floor(fraction * 100))
          const elapsed = performance.now() - started
          const params = { percent, count }
          if (elapsed < 4000 || fraction < 0.03 || fraction >= 1) {
            onProgress({ key: 'historyImportProgress', params })
            return
          }
          const seconds = Math.ceil((elapsed * (1 - fraction)) / fraction / 1000)
          const eta =
            seconds < 60
              ? translate('historyImportEtaSeconds', { seconds })
              : translate('historyImportEtaMinutes', { minutes: Math.ceil(seconds / 60) })
          onProgress({ key: 'historyImportProgressEta', params: { ...params, eta } })
        }),
      { onCommit: () => onProgress?.({ key: 'historyImportReplacing' }), clearInBackground: true }
    )
  })

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {})
  })
