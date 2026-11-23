/**
 * 本地假 OpenAI 兼容端点：用于离线验证自定义端点的兼容性
 * （system 注入、reasoning_content 思考帧解析、自动提取、错误提示）。
 *
 * 用法：node scripts/test-openai-endpoint.mjs   # 监听 8091
 * App 高级设置里配置：
 *   端点格式 = OpenAI Chat Completions
 *   自定义端点 = http://127.0.0.1:8091/v1
 *   模型名称 = test-model（填 bad-model 可测 404 错误提示）
 *   端点 API Key = 任意
 *
 * 每个请求体会打印到 stdout，并追加写入 .test-endpoint-requests.jsonl 供断言。
 */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const PORT = 8091
const LOG_FILE = '.test-endpoint-requests.jsonl'

const sseFrame = (payload) => `data: ${JSON.stringify(payload)}\n\n`

const chatChunks = (text, reasoning) => {
  const frames = [
    { id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' } }] },
  ]
  if (reasoning) {
    frames.push({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { reasoning_content: reasoning } }] })
  }
  frames.push({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text } }] })
  frames.push({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  frames.push({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [] })
  return frames.map(sseFrame).join('') + 'data: [DONE]\n\n'
}

const server = createServer((request, response) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // 允许任意自定义头（* 不覆盖 Authorization，显式列出）
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, x-opencode-session',
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return
  }
  if (!request.url?.endsWith('/chat/completions')) {
    response.writeHead(404, { ...cors, 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: `Unknown path ${request.url}`, code: 'not_found' } }))
    return
  }

  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    let parsed = null
    try {
      parsed = JSON.parse(body)
    } catch {
      response.writeHead(400, { ...cors, 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Invalid JSON' } }))
      return
    }

    // 记录请求体与关键头：注入/会话头/扩展字段断言用
    const record = {
      at: new Date().toISOString(),
      model: parsed.model,
      system: parsed.messages?.find((m) => m.role === 'system')?.content ?? null,
      messageCount: parsed.messages?.length ?? 0,
      stream: parsed.stream,
      max_completion_tokens: parsed.max_completion_tokens,
      max_tokens: parsed.max_tokens,
      reasoning_effort: parsed.reasoning_effort ?? null,
      hasThinkingField: parsed.thinking !== undefined,
      session: request.headers['x-opencode-session'] ?? null,
      tools: parsed.tools ? parsed.tools.map((t) => t.type) : null,
    }
    console.log('[request]', JSON.stringify(record))
    appendFileSync(LOG_FILE, `${JSON.stringify(record)}\n`)

    if (parsed.model === 'bad-model') {
      response.writeHead(404, { ...cors, 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Model not found', code: 'model_not_found' } }))
      return
    }

    // OpenAI chat 格式下 system 已被转成 messages 首条消息，从这里识别提取器请求
    const sys = parsed.messages?.find((m) => m.role === 'system')?.content ?? ''
    const isExtractor = typeof sys === 'string' && sys.startsWith('你是记忆提取器')
    const userText = parsed.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? ''
    response.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    if (isExtractor) {
      // 从用户文本里取前几个字当逐字证据，模拟提取结果
      const quote = String(userText).slice(0, 4)
      const items = quote
        ? [{ dimension: 'daily', content: `用户正在通过测试端点对话（时间 ${new Date().toLocaleTimeString()}）。`, quote }]
        : []
      response.end(chatChunks(JSON.stringify(items)))
    } else {
      // 回显关键请求信息（会话头/扩展字段），便于在界面直接断言
      const echo = JSON.stringify({
        session: request.headers['x-opencode-session'] ?? null,
        tools: parsed.tools ? parsed.tools.map((t) => t.type) : null,
        effort: parsed.reasoning_effort ?? null,
      })
      response.end(chatChunks(echo, '（测试思考帧）正在回显请求信息。'))
    }
  })
})

server.listen(PORT, () => {
  console.log(`[test-openai-endpoint] listening on http://127.0.0.1:${PORT}/v1/chat/completions`)
  console.log(`[test-openai-endpoint] requests are logged to ${LOG_FILE}`)
})
