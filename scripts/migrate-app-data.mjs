/**
 * 旧包 → 新包的一次性配置迁移（通过 WebView CDP 执行）。
 *
 *   node scripts/migrate-app-data.mjs dump 9222 /tmp/dsoc-migration.json
 *   node scripts/migrate-app-data.mjs load 9223 /tmp/dsoc-migration.json
 *   node scripts/migrate-app-data.mjs reload 9223
 *
 * 迁移范围：原生 API Key / chatConfig / 账号资料、IndexedDB `replica` 的
 * characters/memories/models、以及除 debug 日志外的 localStorage 配置。
 * 不迁移聊天历史（chat-demo）与附件 Blob。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [action, port, file] = process.argv.slice(2)
if (!action || !port) {
  console.error('usage: node migrate-app-data.mjs <dump|load|reload> <port> [file]')
  process.exit(1)
}

const targets = await (
  await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5_000) })
).json()
const target = targets.find((item) => item.type === 'page') ?? targets[0]
if (!target?.webSocketDebuggerUrl) {
  console.error('no debuggable WebView target on port', port)
  process.exit(1)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
// 后台 WebView 可能不响应 devtools；超时退出，避免任务永久挂起。
setTimeout(() => {
  console.error('migration timed out')
  process.exit(1)
}, 60_000).unref()
let id = 0
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const mid = ++id
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== mid) return
      socket.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id: mid, method, params }))
  })

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
  }
  return result.result?.value
}

const openReplica = `
  const openReplica = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('replica', 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('memories')) {
        const store = db.createObjectStore('memories', { keyPath: 'id' })
        store.createIndex('characterId', 'characterId')
        store.createIndex('byDimension', ['characterId', 'dimension'])
      }
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
`

const dump = `(async () => {
  ${openReplica}
  const device = window.DeepSeekAndroid ?? {}
  const read = (fn) => {
    try {
      return fn() ?? null
    } catch {
      return null
    }
  }
  const native = {
    apiKey: read(() => device.readApiKey?.()),
    chatConfig: read(() => device.readChatConfig?.()),
    accountProfile: read(() => device.readAccountProfile?.()),
  }
  // debug 日志含请求片段，不属于用户配置，跳过。
  const local = {}
  for (const key of Object.keys(localStorage)) {
    if (key !== 'replica:debug-log') local[key] = localStorage.getItem(key)
  }
  const db = await openReplica()
  const stores = [...db.objectStoreNames]
  const read = (store) => new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const data = {}
  for (const store of ['characters', 'memories', 'models']) {
    if (stores.includes(store)) data[store] = await read(store)
  }
  db.close()
  return { native, local, data, stores }
})()`

const load = (payload) => `(async () => {
  const payload = ${JSON.stringify(payload)}
  const device = window.DeepSeekAndroid ?? {}
  const native = {}
  if (typeof device.writeApiKey === 'function') native.apiKey = device.writeApiKey(payload.native.apiKey ?? null)
  if (typeof device.writeChatConfig === 'function') native.chatConfig = device.writeChatConfig(payload.native.chatConfig ?? null)
  if (typeof device.writeAccountProfile === 'function') native.accountProfile = device.writeAccountProfile(payload.native.accountProfile ?? null)
  for (const [key, value] of Object.entries(payload.local)) {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  }
  ${openReplica}
  const db = await openReplica()
  const tx = db.transaction(['characters', 'memories', 'models'], 'readwrite')
  const counts = {}
  for (const store of ['characters', 'memories', 'models']) {
    const objectStore = tx.objectStore(store)
    objectStore.clear()
    const records = payload.data[store] ?? []
    for (const record of records) objectStore.put(record)
    counts[store] = records.length
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
  return { native, counts, localKeys: Object.keys(payload.local).length }
})()`

socket.addEventListener('open', async () => {
  try {
    if (action === 'dump') {
      if (!file) throw new Error('dump requires an output file')
      const result = await evaluate(dump)
      writeFileSync(file, JSON.stringify(result, null, 2), { encoding: 'utf8', mode: 0o600 })
      console.log(
        JSON.stringify({
          file,
          characters: result.data.characters?.length ?? 0,
          memories: result.data.memories?.length ?? 0,
          models: result.data.models?.length ?? 0,
          localKeys: Object.keys(result.local).length,
          native: {
            apiKey: Boolean(result.native.apiKey),
            chatConfig: Boolean(result.native.chatConfig),
            accountProfile: Boolean(result.native.accountProfile),
          },
        })
      )
    } else if (action === 'load') {
      if (!file) throw new Error('load requires an input file')
      const payload = JSON.parse(readFileSync(file, 'utf8'))
      const result = await evaluate(load(payload))
      console.log(JSON.stringify(result))
    } else if (action === 'reload') {
      await evaluate("location.reload(); 'reloading'")
      console.log('reloading')
    } else {
      throw new Error('unknown action: ' + action)
    }
    socket.close()
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    socket.close()
    process.exit(1)
  }
})
