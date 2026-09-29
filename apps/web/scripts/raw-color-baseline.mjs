/*
 * 生の Tailwind の色（`bg-white`, `text-gray-500`, `border-blue-200` …）が
 * どのファイルに何か所あるかを数えて、`src/lib/raw-color-baseline.json` に書く。
 *
 * 数える理由は `src/lib/raw-colors.test.ts` に書いてある。
 * 意図して基準を増やすときだけ、このスクリプトを流して基準を更新する。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
export const BASELINE = join(SRC, 'lib', 'raw-color-baseline.json')

/*
 * Tailwind の組み込みの色。`slate-800` のような番号付きと、`white` / `black`。
 * 自分たちの語彙（accent, ink, canvas, …）は入れない。
 */
const PALETTE =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const UTILITY =
  'bg|text|border|ring|from|to|via|divide|outline|decoration|accent|fill|stroke|placeholder|caret'

export const RAW_COLOR = new RegExp(
  `\\b(?:${UTILITY})-(?:${PALETTE})(?:-(?:50|[1-9]00|950))?\\b`,
  'g',
)

export function sourceFiles(dir = SRC) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    // 試験は画面に出ないので数えない。説明のために色の名前を書くことがある。
    else if (/\.test\.tsx?$/.test(name)) continue
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full)
  }
  return out.sort()
}

export function countRawColors() {
  const counts = {}
  for (const file of sourceFiles()) {
    const hits = readFileSync(file, 'utf8').match(RAW_COLOR)
    if (hits?.length) counts[relative(SRC, file)] = hits.length
  }
  return counts
}

if (process.argv[1] && process.argv[1].endsWith('raw-color-baseline.mjs')) {
  const counts = countRawColors()
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`${Object.keys(counts).length} ファイル / ${total} か所 を基準にしました。`)
}
