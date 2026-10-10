/**
 * PR で変わった場所から、比べる V8 の板を決める（`tools/v8-pr-check.sh` 用）。
 *
 * 共通部品・共通CSSは保守的に全PC板を選ぶ。画面固有の変更は2つの手がかりを使う。
 * 1. 変わったファイルの中の `data-design-node="<板ID>"` が対応表にあれば、その板。
 * 2. 変わった `page.tsx`/`layout.tsx` の場所が、対応表の画面の場所と
 *    同じなら、その場所の板ぜんぶ。
 *
 * 使い方
 *   node scripts/visual-qa/v8-pr-boards.mjs <土台のref> # 板IDを `,` 区切りで出す
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BASE = process.argv[2] ?? 'origin/codex/development'

export function selectPrBoards(changed, boards, root = ROOT) {
const found = new Set()
for (const file of changed) {
  if (/\.(?:test|spec)\./.test(file)) continue
  // 共通部品の参照先は動的な読み込みも含むため、影響を限定できない時は全PC板で確かめる。
  if (/^apps\/web\/src\/(?:components\/|app\/globals\.css$|lib\/|hooks\/|contexts\/)/.test(file)) {
    for (const [id, entry] of Object.entries(boards)) {
      if (entry.width && entry.route) found.add(id)
    }
  }
  const full = join(root, file)
  if (existsSync(full)) {
    const text = readFileSync(full, 'utf8')
    for (const match of text.matchAll(/data-design-node="([^"]+)"/g)) {
      if (boards[match[1]]) found.add(match[1])
    }
  }
  const page = /apps\/web\/src\/app(\/.*)?\/(page|layout)\.tsx$/.exec(file)
  if (page) {
    const route = page[1] === undefined || page[1] === '' ? '/' : page[1].replace(/\/\([^)]+\)/g, '')
    for (const [id, entry] of Object.entries(boards)) {
      if (entry.route === route) found.add(id)
    }
  }
}
return [...found]
}

async function main() {
  const changed = execFileSync('git', ['diff', '--name-only', `${BASE}...HEAD`, '--', 'apps/web/src'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  const { boards } = JSON.parse(readFileSync(join(HERE, 'v8-design-map.json'), 'utf8'))
  console.log(selectPrBoards(changed, boards).join(','))
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
