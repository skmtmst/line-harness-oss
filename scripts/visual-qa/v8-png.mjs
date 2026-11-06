/**
 * 依存なしの小さな PNG 読み書き（V8 見本比較用）。
 *
 * 画像処理の実物（sharp など）を入れると、撮影用 PC への導入と版の重さが
 * 増える。Playwright の撮る PNG と見本の PNG は、どちらも 8bit・非
 * インターレースの RGB/RGBA/グレーのいずれかなので、その範囲だけ読む。
 * それ以外（16bit・Adam7・パレット等）が来たら、推測せず落とす。
 */
import { inflateSync, deflateSync } from 'node:zlib'

/** PNG 塊の CRC-32（読み手が検査するので 0 では置かない）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function readUInt32BE(buf, at) {
  return buf[at] * 0x1000000 + buf[at + 1] * 0x10000 + buf[at + 2] * 0x100 + buf[at + 3]
}

function readChunk(buf, at) {
  const length = readUInt32BE(buf, at)
  const type = buf.toString('latin1', at + 4, at + 8)
  const data = buf.subarray(at + 8, at + 8 + length)
  // CRC は見ない（壊れた絵は下の復元で落ちる）。
  return { type, data, next: at + 8 + length + 4 }
}

/** PNG を { width, height, rgba }（1画素4バイト）へほどく。 */
export function decodePng(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) throw new Error('PNG ではない')
  let at = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  for (;;) {
    if (at + 8 > buf.length) throw new Error('PNG が途中で切れている')
    const { type, data, next } = readChunk(buf, at)
    at = next
    if (type === 'IHDR') {
      width = readUInt32BE(data, 0)
      height = readUInt32BE(data, 4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }
  if (width === 0 || height === 0) throw new Error('IHDR が無い')
  if (bitDepth !== 8) throw new Error(`8bit 以外（${bitDepth}bit）は読まない`)
  if (interlace !== 0) throw new Error('インターレース PNG は読まない')
  if (![0, 2, 6].includes(colorType)) throw new Error(`色の種類 ${colorType} は読まない`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const rgba = Buffer.alloc(width * height * 4)
  let pos = 0
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]
    pos += 1
    const line = Buffer.from(raw.subarray(pos, pos + stride))
    pos += stride
    if (line.length !== stride) throw new Error('走査線が短い')
    const out = Buffer.alloc(stride)
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        v = (v + pr) & 0xff
      } else if (filter !== 0) throw new Error(`選別子 ${filter} は読まない`)
      out[x] = v
    }
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4
      if (channels === 4) {
        rgba[o] = out[x * 4]
        rgba[o + 1] = out[x * 4 + 1]
        rgba[o + 2] = out[x * 4 + 2]
        rgba[o + 3] = out[x * 4 + 3]
      } else if (channels === 3) {
        rgba[o] = out[x * 3]
        rgba[o + 1] = out[x * 3 + 1]
        rgba[o + 2] = out[x * 3 + 2]
        rgba[o + 3] = 255
      } else {
        rgba[o] = out[x]
        rgba[o + 1] = out[x]
        rgba[o + 2] = out[x]
        rgba[o + 3] = 255
      }
    }
    prev = out
  }
  return { width, height, rgba: Buffer.from(rgba) }
}

/** { width, height, rgba } を PNG（無選別）にする。 */
export function encodePng(image) {
  const { width, height, rgba } = image
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = deflateSync(raw)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'latin1')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0)
    return Buffer.concat([head, data, tail])
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 2枚の重なる範囲を比べる。1画素の差は、RGB のどれかが 24 以上違うとき。
 * 戻りは { fraction, boxes }。boxes は差の強い所（16px ます目で3割以上が
 * 違うますをくっつけたもの、最大 30 箱）。
 */
export function diffImages(a, b) {
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const CELL = 16
  const cols = Math.ceil(width / CELL)
  const rows = Math.ceil(height / CELL)
  const cells = new Uint16Array(cols * rows)
  const totals = new Uint16Array(cols * rows)
  let diff = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * a.width + x) * 4
      const p = (y * b.width + x) * 4
      const d =
        Math.abs(a.rgba[o] - b.rgba[p]) > 24 ||
        Math.abs(a.rgba[o + 1] - b.rgba[p + 1]) > 24 ||
        Math.abs(a.rgba[o + 2] - b.rgba[p + 2]) > 24
      const cell = Math.floor(y / CELL) * cols + Math.floor(x / CELL)
      totals[cell] += 1
      if (d) {
        diff += 1
        cells[cell] += 1
      }
    }
  }
  // 隣り合うますを横にくっつけるだけの、粗い箱化。
  const boxes = []
  const hot = (index) => cells[index] / Math.max(totals[index], 1) >= 0.3
  for (let row = 0; row < rows; row += 1) {
    let start = -1
    for (let col = 0; col <= cols; col += 1) {
      const on = col < cols && hot(row * cols + col)
      if (on && start < 0) start = col
      if (!on && start >= 0) {
        boxes.push({ x: start * CELL, y: row * CELL, w: (col - start) * CELL, h: CELL })
        start = -1
      }
    }
  }
  // 縦に隣り合う箱（同じ x・w）をくっつける。
  boxes.sort((p, q) => p.y - q.y || p.x - q.x)
  const merged = []
  for (const box of boxes) {
    const prev = merged[merged.length - 1]
    if (prev && prev.x === box.x && prev.w === box.w && prev.y + prev.h === box.y) {
      prev.h += box.h
    } else {
      merged.push({ ...box })
    }
  }
  return { fraction: diff / (width * height), boxes: merged.slice(0, 30) }
}

/**
 * 幅だけを縮める（画素密度の違う絵を比べるため）。いちばん近い点を拾い、
 * 縦横比は保つ。拡大はしない（ぼやけた差を作らない）。
 */
export function scaleDown(image, targetWidth) {
  if (image.width <= targetWidth) return image
  const scale = targetWidth / image.width
  const width = targetWidth
  const height = Math.max(1, Math.round(image.height * scale))
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.floor(x / scale)
      const sy = Math.floor(y / scale)
      image.rgba.copy(rgba, (y * width + x) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4)
    }
  }
  return { width, height, rgba, scale }
}

/** 見本（左）と実装（右）を横に並べる。低い方には薄い灰色を敷く。 */
export function sideBySide(a, b, gap = 8) {
  const width = a.width + gap + b.width
  const height = Math.max(a.height, b.height)
  const rgba = Buffer.alloc(width * height * 4, 0)
  const paint = (img, dx) => {
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        img.rgba.copy(rgba, ((y * width + dx + x) * 4), (y * img.width + x) * 4, (y * img.width + x) * 4 + 4)
      }
    }
  }
  // 下地は薄い灰色（#f0f0f2）。
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 0xf0
    rgba[i + 1] = 0xf0
    rgba[i + 2] = 0xf2
    rgba[i + 3] = 0xff
  }
  paint(a, 0)
  paint(b, a.width + gap)
  return { width, height, rgba }
}

/** 実装の絵に、差の箱を赤枠で描く。 */
export function annotate(image, boxes) {
  const rgba = Buffer.from(image.rgba)
  const { width, height } = image
  const dot = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const o = (y * width + x) * 4
    rgba[o] = 0xe5
    rgba[o + 1] = 0x1a
    rgba[o + 2] = 0x1a
    rgba[o + 3] = 0xff
  }
  for (const box of boxes) {
    const x1 = Math.min(box.x + box.w, width) - 1
    const y1 = Math.min(box.y + box.h, height) - 1
    for (let x = box.x; x <= x1; x += 1) {
      dot(x, box.y)
      dot(x, box.y + 1)
      dot(x, y1)
      dot(x, y1 - 1)
    }
    for (let y = box.y; y <= y1; y += 1) {
      dot(box.x, y)
      dot(box.x + 1, y)
      dot(x1, y)
      dot(x1 - 1, y)
    }
  }
  return { width, height, rgba }
}
