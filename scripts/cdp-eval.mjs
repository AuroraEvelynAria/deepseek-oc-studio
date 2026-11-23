/** 通过 CDP 在远程 WebView 页面执行 JS 表达式：node cdp-eval.mjs "<expression>" */
const target = process.argv[2]
const expression = process.argv[3]
if (!target || !expression) {
  console.error('usage: node cdp-eval.mjs <ws-url-or-9222> "<expression>"')
  process.exit(1)
}
const wsUrl = target.startsWith('ws://')
  ? target
  : JSON.parse(await (await fetch(`http://127.0.0.1:${target}/json`)).text())[0].webSocketDebuggerUrl
const socket = new WebSocket(wsUrl)
let id = 0
const send = (method, params) =>
  new Promise((resolve) => {
    const mid = ++id
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === mid) {
        socket.removeEventListener('message', onMessage)
        resolve(msg)
      }
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id: mid, method, params }))
  })
socket.addEventListener('open', async () => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(result.result?.result?.value ?? result, null, 1))
  socket.close()
  process.exit(0)
})
