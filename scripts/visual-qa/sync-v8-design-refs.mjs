/**
 * 見本の画像のうち、実装が対応する板の分だけを取り込む。
 *
 * 全部（496枚）は重いので版に入れない。対応表（`v8-design-map.json`）で
 * 画面の場所が決まった板だけを、司令塔の作業フォルダから
 * `scripts/visual-qa/v8-design-refs/<板ID>.png` へ写す。
 * 写した先は `.gitignore` で版から外す（作り直せるため）。
 *
 * 使い方
 *   node scripts/visual-qa/sync-v8-design-refs.mjs
 *   node scripts/visual-qa/sync-v8-design-refs.mjs --boards ywJ5H,mcOqK
 *   node scripts/visual-qa/sync-v8-design-refs.mjs --all
 *   node scripts/visual-qa/sync-v8-design-refs.mjs --include-html
 *   V8_DESIGN_DIR=/path/to/design node scripts/visual-qa/sync-v8-design-refs.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DESIGN_DIR = process.env.V8_DESIGN_DIR ?? '/Users/kentakenta/lh-work/design/v8'
const DEST = join(HERE, 'v8-design-refs')

const args = process.argv.slice(2)
const pick = (flag) => {
  const at = args.indexOf(flag)
  return at >= 0 && args[at + 1] ? args[at + 1] : null
}
const onlyBoards = pick('--boards')?.split(',').map((id) => id.trim()).filter(Boolean) ?? null
const takeAll = args.includes('--all')
const includeHtml = args.includes('--include-html')

const map = JSON.parse(readFileSync(join(HERE, 'v8-design-map.json'), 'utf8'))
const boards = Object.entries(map.boards)

const targets = boards.filter(([id, entry]) => {
  if (onlyBoards) return onlyBoards.includes(id)
  if (takeAll) return true
  // 既定は「画面の場所が決まった板だけ」。場所なし・LIFF は写さない。
  return Boolean(entry.route)
})

if (!existsSync(DESIGN_DIR)) {
  console.error(`[sync-v8-design-refs] 設計フォルダが無い: ${DESIGN_DIR}`)
  process.exit(1)
}
mkdirSync(DEST, { recursive: true })

let copied = 0
let skipped = 0
const missing = []
for (const [id, entry] of targets) {
  const src = join(DESIGN_DIR, entry.shot ?? `lint/${entry.doc}/shots/${id}.png`)
  const dest = join(DEST, `${id}.png`)
  if (!existsSync(src)) {
    missing.push(id)
    continue
  }
  const fresh = existsSync(dest)
    && statSync(dest).size === statSync(src).size
    && statSync(dest).mtimeMs >= statSync(src).mtimeMs
  if (fresh && !includeHtml) {
    skipped += 1
    continue
  }
  copyFileSync(src, dest)
  copied += 1
  if (includeHtml) {
    const srcHtml = join(DESIGN_DIR, `lint/${entry.doc}/${id}.html`)
    if (existsSync(srcHtml)) copyFileSync(srcHtml, join(DEST, `${id}.html`))
  }
}

console.log(`[sync-v8-design-refs] 写した ${copied} 枚・最新そのまま ${skipped} 枚 → ${DEST}`)
if (missing.length > 0) {
  console.warn(`[sync-v8-design-refs] 見本が無い板 ${missing.length} 件: ${missing.join(', ')}`)
}
