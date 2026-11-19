import { BackupError } from './errors.js'
import { ArchiveSourceError, importArchive } from './importArchive.js'
import type { ImportRequest, ImportResponse } from './importOffMainThread.js'

const send = (response: ImportResponse) => globalThis.postMessage(response)

globalThis.addEventListener(
  'message',
  ({ data }: MessageEvent<ImportRequest>) => {
    void importArchive(data.file, data.importId, (value) => send({ type: 'progress', value })).then(
      (summaries) => send({ type: 'done', summaries }),
      (error: unknown) => {
        if (error instanceof ArchiveSourceError) {
          send({ type: 'unavailable' })
          return
        }
        send({
          type: 'error',
          key: error instanceof BackupError ? error.key : undefined,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    )
  },
  { once: true }
)

send({ type: 'ready', supported: typeof indexedDB !== 'undefined' })
