/**
 * 在导入 client 之前把浏览器全局补齐：原生通道分支要求 window.DeepSeekAndroid。
 * 这里用假桥接模拟两次原生请求：第一次扩展模式 400，第二次基础模式 200 SSE。
 */

type FakeEvent = { id: string; type: string; status?: number; mime?: string; bytes?: string }

const calls: {
  id: string
  endpoint: string
  format: string
  headers: Record<string, string>
  body: Record<string, unknown>
}[] = []

const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64')

const dispatch = (detail: FakeEvent) => {
  const win = globalThis as unknown as { window: EventTarget }
  win.window.dispatchEvent(new CustomEvent('android-custom-chat', { detail }))
}

let sequence = 0
const bridge = {
  readApiKey: () => null,
  readChatConfig: () => null,
  readAccountProfile: () => null,
  beginChatRequest: (endpoint: string, format: string, headersJson: string, body: string) => {
    const id = `req-${++sequence}`
    calls.push({
      id,
      endpoint,
      format,
      headers: JSON.parse(headersJson || '{}') as Record<string, string>,
      body: JSON.parse(body) as Record<string, unknown>,
    })
    const attempt = calls.length
    setTimeout(() => {
      if (attempt === 1) {
        // 扩展模式在生成前拒绝超长输入
        dispatch({ id, type: 'headers', status: 400, mime: 'text/plain' })
        dispatch({
          id,
          type: 'data',
          bytes: encode(
            JSON.stringify({
              error: { message: 'user input too long, 40000 tokens exceeds max 32768 tokens' },
            })
          ),
        })
        dispatch({ id, type: 'end' })
        return
      }
      const sse =
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' + 'data: [DONE]\n\n'
      dispatch({ id, type: 'headers', status: 200, mime: 'text/event-stream' })
      dispatch({ id, type: 'data', bytes: encode(sse) })
      dispatch({ id, type: 'end' })
    }, 0)
    return id
  },
  cancelChatRequest: () => {},
}

class FakeWindow extends EventTarget {}
const fakeWindow = new FakeWindow() as FakeWindow & { DeepSeekAndroid: typeof bridge }
fakeWindow.DeepSeekAndroid = bridge
;(globalThis as unknown as { window: unknown }).window = fakeWindow

export const fakeCalls = calls
