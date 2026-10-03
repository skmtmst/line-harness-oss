/*
 * 「v7 は1画素も変えない」を機械で確かめる。v7-*.png を同じ名前どうしで比べ、
 * 1枚でも違えば終了コード 1。違う所を赤くした画像を出力フォルダに置く。
 *
 *   node apps/web/scripts/v8-guard/v7-pixel-diff.mjs <変える前> <変えた後> [出力フォルダ]
 *
 * 許す差：色の段階 255 のうち 2 まで（影のぼかしの揺れ。同じ版を2回撮って最大 1 だった）。
 * 対照：同じフォルダどうし → 0、1画素だけ塗った写し → 1 を確かめてから入れた（2026-10-01）。
 * PREFIX=v8- ONLY=dashboard,friends で、合格して固定した v8 のページだけを比べる（v8-locked.json。2026-10-01）
 * 同じ CI の中で、統合先の版と PR の版を両方撮って比べる（Mac と Linux では文字の描き方が違うため、手元の写真は基準にしない）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'

const [before, after, outArg] = process.argv.slice(2)
if (!before || !after) throw new Error('使い方: v7-pixel-diff.mjs <変える前> <変えた後> [出力フォルダ]')
const out = outArg ?? join(after, '_v7-diff')
const TOL = 2
const PREFIX = process.env.PREFIX || 'v7-'
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').filter(Boolean)) : null
const names = readdirSync(before)
  .filter((f) => f.startsWith(PREFIX) && f.endsWith('.png'))
  .filter((f) => !ONLY || ONLY.has(f.replace(/\.png$/, '').split('-').slice(2).join('-')))
  .sort()
let bad = 0
for (const n of names) {
  const pb = join(after, n)
  if (!existsSync(pb)) { console.log(`無い\t${n}`); bad += 1; continue }
  const a = PNG.sync.read(readFileSync(join(before, n)))
  const b = PNG.sync.read(readFileSync(pb))
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`大きさが違う\t${n}\t${a.width}x${a.height}→${b.width}x${b.height}`)
    bad += 1
    continue
  }
  const mark = new PNG({ width: a.width, height: a.height })
  let cnt = 0
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]))
    if (d > TOL) {
      cnt += 1
      const p = i / 4; const x = p % a.width; const y = Math.floor(p / a.width)
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
      mark.data[i] = 229; mark.data[i + 1] = 72; mark.data[i + 2] = 77; mark.data[i + 3] = 255
    } else {
      mark.data[i] = (b.data[i] >> 1) + 128; mark.data[i + 1] = (b.data[i + 1] >> 1) + 128; mark.data[i + 2] = (b.data[i + 2] >> 1) + 128; mark.data[i + 3] = 255
    }
  }
  if (!cnt) { console.log(`同じ\t${n}`); continue }
  bad += 1
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, n), PNG.sync.write(mark))
  console.log(`違う\t${n}\t${cnt} 画素\t範囲 ${x0},${y0}〜${x1},${y1}`)
}
console.log(`合計 ${names.length} 枚・違う ${bad} 枚`)
if (!names.length) { console.log('比べる写真がありません'); process.exit(1) }
if (bad) process.exit(1)
