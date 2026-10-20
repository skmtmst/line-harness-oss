/** 画面CSSの現在の宣言数を報告する。上限・基準表は持たない。 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
export const APP = join(SRC, 'app')
export const V8 = join(SRC, 'v8')
/** 画面の CSS を置く場所。型・部品（components）は変数の定義場所なので数えない。 */
export const SCREEN_DIRS = [APP, V8]

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

export function screenFiles(dir) {
  if (dir === undefined) return SCREEN_DIRS.flatMap((root) => screenFiles(root)).sort()
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...screenFiles(full))
    else if (name.endsWith('.module.css') && !/\.test\./.test(name)) out.push(full)
  }
  return out.sort()
}

export function countScreenCss(src = SRC) {
  const counts = {}
  for (const file of [join(src, 'app'), join(src, 'v8')].flatMap(dir => screenFiles(dir))) {
    const source = stripComments(readFileSync(file, 'utf8'))
    const entry = {
      spacing: countAll(source, SPACING_CSS),
      height: countAll(source, HEIGHT_CSS),
      font: countAll(source, FONT_CSS),
    }
    if (entry.spacing + entry.height + entry.font > 0) {
      counts[relative(src, file)] = entry
    }
  }
  return counts
}

if (process.argv[1] && process.argv[1].endsWith('screen-css-budget.mjs')) {
  console.log(JSON.stringify(countScreenCss(), null, 2))
}
