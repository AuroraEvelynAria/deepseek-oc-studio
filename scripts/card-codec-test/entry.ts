import { strict as assert } from 'node:assert'
import {
  CardError,
  exportCharacterAsPngCard,
  exportPersonaJson,
  parsePersonaCard,
  readCharacterCardFromPng,
} from '../../src/services/characters/cardCodec.js'
import type { Character, MemoryCard } from '../../src/services/characters/types.js'

const character: Character = {
  id: 'char-test',
  name: '夜岚',
  avatar: null,
  prompt: '冷静的刀客。说话简短，讨厌客套。🐳 中文与 emoji 都要原样保留。',
  memoryEnabled: true,
  createdAt: 1,
  updatedAt: 2,
}

const memory: MemoryCard = {
  id: 'm1',
  characterId: 'char-test',
  dimension: 'preference',
  content: '用户喜欢在深夜写字，讨厌被打断。',
  source: { sessionId: 's1', quote: '我喜欢深夜写字' },
  enabled: true,
  importance: 2,
  createdAt: 3,
  updatedAt: 4,
}

const main = async () => {
  // 1) 真实的 PNG 写入 → 读取往返（含中文/emoji）
  const png = await exportCharacterAsPngCard(character)
  const parsed = await readCharacterCardFromPng(png)
  assert.equal(parsed.card.name, character.name)
  assert.equal(parsed.card.description, character.prompt)
  assert.equal((parsed.card.data as { description?: string }).description, character.prompt)

  // 2) 真实 PNG 字节里移动 tEXt 到 IDAT 之后，仍必须能读出来
  const bytes = new Uint8Array(await png.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const chunks: { type: number; start: number; end: number }[] = []
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset, false)
    const type = view.getUint32(offset + 4, false)
    chunks.push({ type, start: offset, end: offset + 12 + length })
    offset += 12 + length
  }
  const textIndex = chunks.findIndex((chunk) => chunk.type === 0x74455874)
  const dataIndex = chunks.findIndex((chunk) => chunk.type === 0x49444154)
  assert.ok(textIndex >= 0 && dataIndex >= 0, 'expected tEXt and IDAT chunks')
  if (textIndex < dataIndex) {
    const textChunk = bytes.slice(chunks[textIndex].start, chunks[textIndex].end)
    const without = new Uint8Array(bytes.length - textChunk.length)
    without.set(bytes.slice(0, chunks[textIndex].start), 0)
    without.set(bytes.slice(chunks[textIndex].end), chunks[textIndex].start)
    const insertAt = chunks[dataIndex].end - textChunk.length
    const moved = new Uint8Array(without.length + textChunk.length)
    moved.set(without.slice(0, insertAt), 0)
    moved.set(textChunk, insertAt)
    moved.set(without.slice(insertAt), insertAt + textChunk.length)
    const reparsed = await readCharacterCardFromPng(new Blob([moved], { type: 'image/png' }))
    assert.equal(reparsed.card.name, character.name)
  }

  // 3) persona 卡：中文 + 记忆往返
  const persona = await parsePersonaCard(exportPersonaJson(character, [memory]))
  assert.equal(persona.character.name, character.name)
  assert.equal(persona.memories.length, 1)
  assert.equal(persona.memories[0].content, memory.content)
  assert.equal(persona.memories[0].importance, 2)

  // 4) 坏记忆必须被拒绝，而不是写进库里导致记忆视图/注入崩溃
  const badCards: unknown[] = [
    { ...memory, dimension: 'evil' },
    { ...memory, content: 5 },
    { ...memory, content: 'x'.repeat(801) },
    { ...memory, enabled: 'yes' },
    { ...memory, importance: 9 },
  ]
  for (const bad of badCards) {
    const body = JSON.stringify({
      format: 'replica.persona',
      version: 1,
      character: { name: '夜岚', prompt: 'x', avatar: null, memoryEnabled: true },
      memories: [bad],
    })
    await assert.rejects(
      () => parsePersonaCard(new Blob([body], { type: 'application/json' })),
      (error: unknown) => error instanceof CardError && error.reason === 'invalidPersona'
    )
  }

  console.log('card-codec real-module round-trip: PASS')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
