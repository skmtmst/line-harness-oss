/**
 * V8 の画面をぜんぶ撮って、ずれの大きい順に並べる（一括実行）。
 *
 * 1枚ずつの `v8-parity.mjs` を、ブラウザを使い回して回す。
 * 同じ URL の板は1回だけ開き、見本との突き合わせは板ごとにやる
 * （同じ実装を、違う状態の板と比べるため）。
 *
 * 前に用意するもの
 *   node scripts/visual-qa/mock-api.mjs &
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web exec next dev --port 3101 &
 *
 * 使い方
 *   node scripts/visual-qa/v8-parity-all.mjs [--out dir] [--boards a,b] [--doc V8|V8-B] [--limit N]
 *
 * 出るもの（`out/`）
 *   <板ID>-<幅>/metrics.json・impl.png・side-by-side.png・diff.png（1枚ずつと同じ）
 *   v8-parity-report.md … ずれの大きい順の一覧（PR に貼れる形）
 *
 * 報告だけに使う（落とさない）。`drift` は目安の点数（重みは仮決め）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HERE,
  VISUAL_QA_BASE,
  compareAndWrite,
  isNoStateBoard,
  loadMap,
  refPaths,
  resolveTarget,
  shootUrl,
} from './v8-parity.mjs'

const ROOT = join(HERE, '..', '..')
const args = process.argv.slice(2)
const pick = (flag) => {
  const at = args.indexOf(flag)
  return at >= 0 && args[at + 1] ? args[at + 1] : null
}

const OUT = pick('--out') ?? join(HERE, 'v8-parity-out')
const onlyBoards = pick('--boards')?.split(',').map((id) => id.trim()).filter(Boolean) ?? null
const onlyDoc = pick('--doc') ?? null
const limit = Number(pick('--limit') ?? 0)

const map = loadMap()
const boards = Object.entries(map.boards)

// 対象：場所と幅が決まり、実装の page がある板。お客さまの画面（LIFF・
// 幅なし）・まだ場所が無い板は「未対象」として数えるだけ。
const targets = []
const skipped = []
for (const [board, entry] of boards) {
  if (onlyBoards && !onlyBoards.includes(board)) continue
  if (onlyDoc && entry.doc !== onlyDoc) continue
  let route = null
  try {
    route = resolveTarget(map, board, null, null).route
  } catch {
    skipped.push({ board, reason: '場所なし（まだ積み替え前）' })
    continue
  }
  const width = entry.width
  if (!width) {
    skipped.push({ board, reason: '幅なし（PC点検の対象外）' })
    continue
  }
  const page = join(ROOT, 'apps', 'web', 'src', 'app', route === '/' ? 'page.tsx' : `${route.replace(/^\//, '')}/page.tsx`)
  if (!existsSync(page)) {
    skipped.push({ board, reason: `実装なし（${route}）` })
    continue
  }
  targets.push({ board, entry, route: entry.url ?? route, width })
}
const runTargets = limit > 0 ? targets.slice(0, limit) : targets
console.log(`[v8-parity-all] 対象 ${runTargets.length} 板・対象外 ${skipped.length} 板 → ${OUT}`)

// 見本の写しをまとめて用意する。
try {
  execFileSync('node', [join(HERE, 'sync-v8-design-refs.mjs'), '--boards', runTargets.map((t) => t.board).join(',')], {
    stdio: 'inherit',
  })
} catch {
  console.error('[v8-parity-all] 見本の写しに失敗。続ける（無い板は飛ばす）。')
}

const { chromium } = await import('@playwright/test')
let browser = null
try {
  browser = await chromium.launch()
} catch (error) {
  console.error(`[v8-parity-all] ブラウザが開けない: ${error.message}`)
  console.error('[v8-parity-all] 初回だけ `npx playwright install chromium` が要る。')
  process.exit(3)
}

// 同じ URL・幅は1回だけ開く。
const shots = new Map()
const failures = []
for (const target of runTargets) {
  const key = `${target.route} @${target.width}`
  if (shots.has(key)) continue
  try {
    shots.set(key, await shootUrl(browser, VISUAL_QA_BASE, target.route, target.width))
    console.log(`[v8-parity-all] 撮影 ${key}`)
  } catch (error) {
    failures.push({ board: target.board, reason: String(error.message).slice(0, 160) })
    shots.set(key, null)
    console.error(`[v8-parity-all] 撮影できず ${key}: ${error.message}`)
  }
}
await browser.close()

const results = []
for (const target of runTargets) {
  const shot = shots.get(`${target.route} @${target.width}`)
  if (!shot) continue
  const refs = refPaths(target.entry, target.board)
  if (!refs.png) {
    failures.push({ board: target.board, reason: '見本なし' })
    continue
  }
  const outDir = join(OUT, `${target.board}-${target.width}`)
  const metrics = compareAndWrite({
    board: target.board,
    route: target.route,
    width: target.width,
    url: shot.url,
    refPng: refs.png,
    refHtml: refs.html,
    measured: shot.measured,
    shotBuffer: shot.shotBuffer,
    outDir,
  })
  results.push({ ...target, metrics })
}

// 状態を開けない板（ダイアログ・確認・引き出し）は元の画面だけでは
// その状態が出ないので、drift の順位に入れず別の表に分ける。
const noStateBoards = results.filter((result) => isNoStateBoard(result.entry))
const ranked = results.filter((result) => !isNoStateBoard(result.entry))
ranked.sort((a, b) => b.metrics.drift - a.metrics.drift)

const rowOf = (result, rank) => {
  const m = result.metrics
  return `| ${rank} | ${result.board} | ${result.entry.name} | ${result.width} | ${m.drift} | ${(m.pixelDiffFraction * 100).toFixed(1)}% | ${m.overflows.length} | ${m.viewportOverflows.length} | ${m.midWordBreaks.length} | ${m.tableMisalignments.length} | ${m.fontIssues.length} | ${m.missingInImpl.length} |`
}

const lines = []
lines.push('# V8 見本比較（一括・報告だけ・落とさない）')
lines.push('')
lines.push(`対象 ${runTargets.length} 板・撮影できた ${results.length} 板（順位 ${ranked.length}・状態を開けない板 ${noStateBoards.length}）・できなかった ${failures.length} 件・対象外 ${skipped.length} 板。`)
lines.push('`drift` は目安の点数（大きいほどずれている。重みは仮決め）。画素の差は幅・DPR を縮めて比べた粗い目安。')
lines.push('')
lines.push('| 順位 | 板 | 画面 | 幅 | drift | 画素の差 | はみ出し | 右端越え | 途中改行 | 列表れ | 書体 | 見本の文字不足 |')
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
ranked.forEach((result, index) => {
  lines.push(rowOf(result, index + 1))
})
lines.push('')
lines.push('## 状態を開けない板（元の画面だけでは状態が出ない・順位外）')
lines.push('')
lines.push('| 順位 | 板 | 画面 | 幅 | drift | 画素の差 | はみ出し | 右端越え | 途中改行 | 列表れ | 書体 | 見本の文字不足 |')
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const result of noStateBoards) {
  lines.push(rowOf(result, '—'))
}
lines.push('')
for (const result of ranked.slice(0, 30)) {
  const m = result.metrics
  lines.push(`## ${result.board} ${result.entry.name}（drift ${m.drift}）`)
  lines.push('')
  lines.push(`- 場所: ${result.route}・幅 ${result.width}`)
  lines.push(`- 画像: \`${result.board}-${result.width}/side-by-side.png\`（左が見本）・\`${result.board}-${result.width}/diff.png\`（赤枠）`)
  if (m.overflows.length > 0) {
    lines.push(`- はみ出し ${m.overflows.length} 件: ${m.overflows.slice(0, 3).map((o) => `${o.path}（枠${o.clientWidth}＞中${o.scrollWidth}）`).join('／')}`)
  }
  if (m.viewportOverflows.length > 0) {
    lines.push(`- 右端越え ${m.viewportOverflows.length} 件: ${m.viewportOverflows.slice(0, 3).map((o) => o.path).join('／')}`)
  }
  if (m.tableMisalignments.length > 0) {
    lines.push(`- 列表れ ${m.tableMisalignments.length} 件: ${m.tableMisalignments.slice(0, 3).map((t) => t.path).join('／')}`)
  }
  if (m.missingInImpl.length > 0) {
    lines.push(`- 見本にあって実装に無い文字 ${m.missingInImpl.length} 件: ${m.missingInImpl.slice(0, 5).join('／')}`)
  }
  lines.push('')
}
if (failures.length > 0) {
  lines.push('## 撮れなかったもの')
  lines.push('')
  for (const failure of failures) lines.push(`- ${failure.board}: ${failure.reason}`)
  lines.push('')
}
if (skipped.length > 0) {
  lines.push(`## 対象外（${skipped.length} 板・積み替え前か PC 点検の対象外）`)
  lines.push('')
  const reasons = new Map()
  for (const item of skipped) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1)
  for (const [reason, count] of reasons) lines.push(`- ${reason}: ${count} 板`)
  lines.push('')
}
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'v8-parity-report.md'), `${lines.join('\n')}\n`)
console.log(`[v8-parity-all] 一覧 → ${join(OUT, 'v8-parity-report.md')}`)
