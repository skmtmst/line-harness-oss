/** 現在値の計測だけを行い、凍結表へ書かない。 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const HEX = /#[0-9a-fA-F]{3,8}\b/g
const COLOR_FUNC = /\b(?:rgba?|hsla?|oklch|oklab)\s*\(/g

/*
 * className の丸み。トークン名（rounded-card 等）や `rounded-none`
 * （丸みを消す指定で、値を書いていない）は数えない。
 * `-` が語境界なので、裸の `rounded`（Tailwind 既定の 4px = 直書き）は
 * `rounded` の後ろに `-` が続かない形だけを拾う。
 */
const ROUNDED_CLASS =
  /\brounded(?:-(?:tl|tr|bl|br|t|b|l|r|s|e|ss|se|ee|es))?-(?:sm|md|lg|xl|2xl|3xl|full|\[[^\]]*\])\b|\brounded\b(?!-)/g
const RADIUS_STYLE = /\bborderRadius\s*:\s*['"`\d]/g
// (?!\s*var\ はコロンの直後に置く。`\s*` の後ろに置くと、空白を
// 読み戻して var の手前で止まる道が残り、トークン参照まで数えてしまう。
const RADIUS_CSS = /\bborder-radius\s*:(?!\s*var\()\s*[^;}\n]+/g

/* 影も同じ。トークンは shadow-card / shadow-float / shadow-overlay。 */
const SHADOW_CLASS =
  /\bshadow-(?:sm|md|lg|xl|2xl|inner|\[[^\]]*\])\b|\bshadow\b(?!-)/g
const SHADOW_STYLE = /\bboxShadow\s*:\s*['"`]/g
const SHADOW_CSS = /\bbox-shadow\s*:(?!\s*(?:var\(|none\b|inherit\b))\s*[^;}\n]+/g

/**
 * ファイルを数える対象にするか。
 * globals.css はトークンの正本そのもの、試験は画面に出ないので外す。
 */
function isSource(name) {
  if (/\.test\.[cm]?[jt]sx?$/.test(name)) return false
  if (name === 'globals.css') return false
  return /\.([cm]?[jt]sx?|css)$/.test(name)
}

export function sourceFiles(dir = SRC) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (isSource(name)) out.push(full)
  }
  return out.sort()
}

/*
 * コメントを落とす。`// #976 の対応` のような Issue 番号や
 * 「#087a3e は 4.46:1」のような設計の写しを、直書きの値として
 * 数えないため。`//` の手前が `:` のもの（`https://` …）は残す。
 */
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

export function countDirectValues() {
  const counts = {}
  for (const file of sourceFiles()) {
    const source = stripComments(readFileSync(file, 'utf8'))
    const entry = file.endsWith('.css')
      ? {
          color: countAll(source, HEX, COLOR_FUNC),
          radius: countAll(source, RADIUS_CSS),
          shadow: countAll(source, SHADOW_CSS),
        }
      : {
          color: countAll(source, HEX, COLOR_FUNC),
          radius: countAll(source, ROUNDED_CLASS, RADIUS_STYLE),
          shadow: countAll(source, SHADOW_CLASS, SHADOW_STYLE),
        }
    if (entry.color + entry.radius + entry.shadow > 0) {
      counts[relative(SRC, file)] = entry
    }
  }
  return counts
}

if (process.argv[1] && process.argv[1].endsWith('direct-values-baseline.mjs')) {
  console.log(JSON.stringify(countDirectValues(), null, 2))
}
