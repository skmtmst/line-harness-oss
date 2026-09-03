/*
  設計の文字（`docs/design-reference/<dir>/<node>.txt`）と
  実装の文字（`docs/design-qa/<dir>/<node>.txt`）を突き合わせる。

  **絵を1枚ずつ見るのは限界がある。** 262枚を人が見比べると、
  ダッシュボードで見つけた「優先度順」「9,110分前」のような1語の違いは
  ほぼ確実に見落とす。文字にしておけば機械が全部並べられる。

  出さないもの:
    - 固定データそのもの（人名・日付・数・ファイル名）。
      設計とモックで中身が違うのは当たり前で、毎回出ると本当の違いが埋もれる。
    - **ほとんどの画面に出る言葉**（サイドメニュー・トップバー）。
      これは画面ごとの違いではないので、最後に1回だけまとめて出す。

  使い方:
    node scripts/visual-qa/compare-text.mjs [--feature N] [--chrome]
*/
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCREENS } from './screens.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 固定データらしい行を落とす。
 *
 * **ここを緩めすぎると本当の違いが埋もれ、きつくすると見落とす。**
 * 迷ったら残す側に倒している（人が読んで捨てるほうが安全）。
 */
const DATA_LIKE = [
  /^\d/,                       // 数で始まる
  /^\W+$/u,                    // 記号だけ
  /\d{4}\/\d{2}\/\d{2}/,       // 日付
  /\d{1,2}:\d{2}/,             // 時刻
  /\.(png|jpe?g|gif|pdf|csv|mp4|zip)\b/i,  // ファイル名を含む
  /^Ver\./,                    // 版
  /\d+\s?(KB|MB|GB|通|件|人|回|円|%)/,      // 量
  /^[A-Z]{2,5}\s*／/,          // 「JPG ／ …」のような仕様行
]

function words(file) {
  if (!existsSync(file)) return null
  const set = new Set()
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.length > 60) continue          // 長いものは語ではなく文
    if (DATA_LIKE.some((re) => re.test(line))) continue
    set.add(line)
  }
  return set
}

const only = process.argv.includes('--feature')
  ? Number(process.argv[process.argv.indexOf('--feature') + 1])
  : null
const showChrome = process.argv.includes('--chrome')

const pairs = []
for (const s of SCREENS) {
  if (s.status === 'unimplemented') continue
  if (only !== null && s.feature !== only) continue
  const design = words(join(ROOT, 'docs', 'design-reference', s.dir, `${s.node}.txt`))
  const impl = words(join(ROOT, 'docs', 'design-qa', s.dir, `${s.node}.txt`))
  if (design && impl) pairs.push({ s, design, impl })
}

/**
 * どの画面にも出る言葉＝画面の外枠（サイドメニュー・トップバー）。
 * 8割以上の画面に出るものを外枠とみなす。
 */
function chromeOf(key) {
  const count = new Map()
  for (const p of pairs) for (const w of p[key]) count.set(w, (count.get(w) ?? 0) + 1)
  const threshold = Math.max(2, Math.ceil(pairs.length * 0.8))
  return new Set([...count].filter(([, n]) => n >= threshold).map(([w]) => w))
}
const designChrome = chromeOf('design')
const implChrome = chromeOf('impl')

let differing = 0
for (const { s, design, impl } of pairs) {
  const missing = [...design].filter((w) => !impl.has(w) && !designChrome.has(w))
  const extra = [...impl].filter((w) => !design.has(w) && !implChrome.has(w))
  if (missing.length === 0 && extra.length === 0) continue
  differing += 1
  console.log(`\n=== ${s.node} ${s.name} ===`)
  if (missing.length) console.log('  設計にあって実装に無い :', missing.join(' / '))
  if (extra.length) console.log('  実装にあって設計に無い :', extra.join(' / '))
}

if (showChrome) {
  const dOnly = [...designChrome].filter((w) => !implChrome.has(w))
  const iOnly = [...implChrome].filter((w) => !designChrome.has(w))
  console.log('\n=== 画面の外枠（全画面で共通） ===')
  if (dOnly.length) console.log('  設計にあって実装に無い :', dOnly.join(' / '))
  if (iOnly.length) console.log('  実装にあって設計に無い :', iOnly.join(' / '))
  if (!dOnly.length && !iOnly.length) console.log('  差なし')
}

console.log(`\n突き合わせた画面 ${pairs.length} ／ 差があった画面 ${differing}`)
