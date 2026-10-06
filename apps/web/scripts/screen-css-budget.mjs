/*
 * 画面の module.css に書いた「余白・高さ・文字の大きさ」を数えて、
 * `src/lib/screen-css-budget-baseline.json` に書く。
 *
 * 一覧の型の寸法は型の CSS の変数（--tpl-*）に1か所まとめている。
 * 画面側の CSS で余白・高さ・文字の大きさを直書きすると、絵を変える
 * たびに画面ごとの書き換えが要る。ここは design-lint の1系統として
 * 数え、本線より増えたら点検で止める
 * （`src/lib/screen-css-budget.test.ts` が比較する）。
 *
 * 数える対象: src/app 以下の *.module.css だけ（画面の CSS）。
 * 部品・型の CSS は対象外（変数の定義場所なので）。
 *   spacing  var() 以外の margin*・padding* の宣言
 *   height   var() 以外の height・min-height・max-height の宣言
 *   font     var() 以外の font-size の宣言
 *
 * var(--tpl-*) の参照は数えない（そちらが正しい書き方）。
 * `.test.*` は画面に出ないので数えない。
 *
 * 意図して基準を増やすときだけ、このスクリプトを流して基準を更新する:
 *
 *     node apps/web/scripts/screen-css-budget.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
export const APP = join(SRC, 'app')
export const BASELINE = join(SRC, 'lib', 'screen-css-budget-baseline.json')

const SPACING_CSS =
  /\b(?:margin|padding)(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?\s*:(?!\s*var\()\s*[^;}\n]+/g
const HEIGHT_CSS = /\b(?:min-|max-)?height\s*:(?!\s*var\()\s*[^;}\n]+/g
const FONT_CSS = /\bfont-size\s*:(?!\s*var\()\s*[^;}\n]+/g

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<!:)\/\/[^\n]*/g, '')
}

function countAll(source, ...patterns) {
  let total = 0
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    total += source.match(pattern)?.length ?? 0
  }
  return total
}

export function screenFiles(dir = APP) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...screenFiles(full))
    else if (name.endsWith('.module.css') && !/\.test\./.test(name)) out.push(full)
  }
  return out.sort()
}

export function countScreenCss() {
  const counts = {}
  for (const file of screenFiles()) {
    const source = stripComments(readFileSync(file, 'utf8'))
    const entry = {
      spacing: countAll(source, SPACING_CSS),
      height: countAll(source, HEIGHT_CSS),
      font: countAll(source, FONT_CSS),
    }
    if (entry.spacing + entry.height + entry.font > 0) {
      counts[relative(SRC, file)] = entry
    }
  }
  return counts
}

if (process.argv[1] && process.argv[1].endsWith('screen-css-budget.mjs')) {
  const counts = countScreenCss()
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`)
  const totals = { spacing: 0, height: 0, font: 0 }
  for (const entry of Object.values(counts)) {
    totals.spacing += entry.spacing
    totals.height += entry.height
    totals.font += entry.font
  }
  console.log(
    `${Object.keys(counts).length} ファイルを基準にしました。` +
      ` 余白 ${totals.spacing} / 高さ ${totals.height} / 文字 ${totals.font}`,
  )
}
