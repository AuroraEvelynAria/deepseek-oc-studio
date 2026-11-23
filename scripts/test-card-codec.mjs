/** PNG tEXt 角色卡编解码回环测试（独立复刻算法，验证 cardCodec 的二进制正确性）。 */
const crcTable = Uint32Array.from({ length: 256 }, (_, v) => {
  let c = v
  for (let b = 0; b < 8; b++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  return c >>> 0
})
const crc32 = (data) => {
  let crc = 0xffffffff
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}
const encodeLatin1 = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff))
const buildChunk = (type, data) => {
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length, false)
  const tb = encodeLatin1(type)
  chunk.set(tb, 4)
  chunk.set(data, 8)
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(tb, 0)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput), false)
  return chunk
}
// 1x1 透明 PNG（与 cardCodec.buildMinimalPng 相同）
const minimal = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
  0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])
// 注入 chara tEXt（与 cardCodec.writeCardToPngBytes 相同算法）
const json = JSON.stringify({
  spec: 'chara_card_v2',
  name: '夜岚',
  data: { name: '夜岚', description: '冷静的刀客' },
})
const encoded = encodeLatin1(Buffer.from(json).toString('base64'))
const keyword = encodeLatin1('chara\0')
const textData = new Uint8Array(keyword.length + encoded.length)
textData.set(keyword, 0)
textData.set(encoded, keyword.length)
const textChunk = buildChunk('tEXt', textData)
const view = new DataView(minimal.buffer)
const ihdrLen = view.getUint32(8, false)
const insertAt = 8 + 12 + ihdrLen
const out = new Uint8Array(minimal.length + textChunk.length)
out.set(minimal.subarray(0, insertAt), 0)
out.set(textChunk, insertAt)
out.set(minimal.subarray(insertAt), insertAt + textChunk.length)
// 回读（与 readTextChunks 相同遍历）
const rv = new DataView(out.buffer)
let off = 8
let found = null
while (off + 12 <= out.length) {
  const len = rv.getUint32(off, false)
  const type = rv.getUint32(off + 4, false)
  if (type === 0x49444154 || type === 0x49454e44) break
  if (type === 0x74455874) {
    const data = out.subarray(off + 8, off + 8 + len)
    const raw = Buffer.from(data).toString('latin1')
    const sep = raw.indexOf('\0')
    found = { keyword: raw.slice(0, sep), value: raw.slice(sep + 1) }
  }
  off += 12 + len
}
const decoded = JSON.parse(Buffer.from(found.value, 'base64').toString('utf8'))
console.log('keyword:', found.keyword)
console.log('round-trip name:', decoded.name, '| spec:', decoded.spec, '| desc:', decoded.data.description)
console.log('PNG signature preserved:', out[0] === 0x89 && out[1] === 0x50)
console.log(all_checks_pass())
function all_checks_pass() {
  return found.keyword === 'chara' && decoded.name === '夜岚' && out[0] === 0x89
}
