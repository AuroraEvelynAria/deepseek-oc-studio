import { strict as assert } from 'node:assert'
// 必须先于 client 导入：client 的依赖链在模块求值时读取 window/原生桥。
import { fakeCalls } from './setup.js'
import { streamChatMessage } from '../../src/services/api/client.js'
import type { ChatConfig } from '../../src/services/api/chatConfig.js'
import type { CreateMessageRequest } from '../../src/services/api/types.js'

const config: ChatConfig = {
  model: 'deepseek-v4.1-flash',
  endpoint: 'https://fake.local/v1/chat/completions',
  format: 'chat',
  apiKey: 'test-key',
  compatible: true,
  headers: { 'x-test-header': 'kept' },
}

const body: CreateMessageRequest = {
  model: config.model,
  max_tokens: 256,
  system: 'test system',
  messages: [{ role: 'user', content: 'hello' }],
  thinking: { type: 'disabled' },
  safety_check: true,
  tools: [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }],
  title: { enabled: true },
}

const main = async () => {
  let text = ''
  for await (const event of streamChatMessage(
    config,
    'test-key',
    body,
    new AbortController().signal
  )) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }

  assert.equal(text, 'ok', '基础模式重试应正常流式返回')
  assert.equal(fakeCalls.length, 2, '应恰好重试一次')
  const [first, second] = fakeCalls
  assert.ok(first.body.tools, '第一次应携带扩展 tools')
  assert.equal(first.body.safety_check, true)
  assert.deepEqual(first.body.title, { enabled: true })
  assert.equal(first.headers['x-test-header'], 'kept', '自定义头应传给原生通道')
  assert.equal(second.body.tools, undefined, '重试应移除 tools')
  assert.equal('safety_check' in second.body, false, '重试应移除 safety_check')
  assert.equal(second.body.title, undefined, '重试应移除 title')
  assert.deepEqual(second.body.messages, first.body.messages, '重试应保留同一上下文')

  // 官方端点（endpoint 为空）即使 compatible 也必须走 fetch，不能交给原生通道。
  const originalFetch = globalThis.fetch
  const fetched: { url: string; headers: Headers }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetched.push({
      url: String(input),
      headers: new Headers(init?.headers),
    })
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch
  try {
    let officialText = ''
    for await (const event of streamChatMessage(
      { model: '', endpoint: '', format: 'chat', apiKey: 'official-key' },
      'official-key',
      body,
      new AbortController().signal
    )) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        officialText += event.delta.text
      }
    }
    assert.equal(officialText, 'ok')
    assert.equal(fakeCalls.length, 2, '官方端点不应再启动原生通道')
    assert.equal(fetched.length, 1)
    assert.match(fetched[0].url, /api\.deepseek\.com\/chat\/completions$/)
    assert.equal(fetched[0].headers.get('Authorization'), 'Bearer official-key')
  } finally {
    globalThis.fetch = originalFetch
  }

  console.log('native fallback + official routing: PASS')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
