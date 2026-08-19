/*
 * 画面で使っている色・角丸の名前が、実際に定義されているか。
 *
 * Tailwind は知らない名前を書いても**黙って何も出さない**。`border-line` と
 * 書くと（正しくは `border-hairline`）、枠線が消えたまま気づけない。
 * 型検査もビルドも通るので、画面を開いて目で見るまで分からない。
 *
 * 実際に起きた: 条件ビルダー・アクション設定・質問・窓の4部品で
 * `border-line` を48か所、`bg-*-soft` を4か所使っていて、入力欄の枠が
 * 1本も出ていなかった。
 *
 * 見る範囲は**自分たちが globals.css で定義した語彙だけ**にしてある。
 * Tailwind の組み込み（border-b, divide-y, shadow-md …）まで判定しようと
 * すると、規則を書き写すことになり、そちらが間違いの元になる。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..')
const GLOBALS = join(SRC, 'app/globals.css')

function definedTokens(prefix: 'color' | 'radius'): Set<string> {
  const css = readFileSync(GLOBALS, 'utf8')
  const out = new Set<string>()
  for (const m of css.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+)\\s*:`, 'g'))) out.add(m[1])
  return out
}

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full))
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * 自分たちの語彙の頭。ここで始まる名前は、必ず定義どおりに書かれている
 * はずなので、1文字でも違えば間違い。
 *
 * `on-accent` は `on` で始まるが、`on` だけの色は無いので頭に入れない。
 */
const OWN_FAMILIES = [
  'accent',
  'ink',
  'canvas',
  'hairline',
  'success',
  'warning',
  'danger',
  'info',
  'on-accent',
]

/**
 * 定義されていないのに、つい書いてしまう名前。
 *
 * 語彙の頭で拾えないものをここに置く。実際に間違えたものを足していく。
 */
const KNOWN_WRONG = new Map<string, string>([
  ['line', 'border-hairline'],
  ['muted', 'text-ink-secondary / text-ink-faint'],
  ['subtle', 'text-ink-faint'],
  ['surface', 'bg-canvas / bg-canvas-sunken'],
])

/** 色を指せる接頭辞。方向（-t/-b/-l/-r/-x/-y）が挟まることがある。 */
const COLOR_PREFIX = '(?:bg|text|border|ring|divide|outline|fill|stroke|from|via|to|placeholder|caret|decoration|accent|shadow)'
const VARIANTS = '(?:[a-z-]+:)*'

describe('デザイントークン', () => {
  const colors = definedTokens('color')
  const radii = definedTokens('radius')
  const files = tsxFiles(SRC)

  it('globals.css からトークンを読めている', () => {
    expect(colors.has('hairline')).toBe(true)
    expect(colors.has('ink-secondary')).toBe(true)
    expect(colors.has('danger-bg')).toBe(true)
    expect(radii.has('card')).toBe(true)
  })

  it('自分たちの色は、定義どおりの名前で書かれている', () => {
    const bad: string[] = []
    const re = new RegExp(
      `(?:^|[\\s"'\`{])${VARIANTS}${COLOR_PREFIX}(?:-[trblxy]{1,2})?-([a-z][a-z0-9-]*)(?=[\\s"'\`}])`,
      'g',
    )
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(re)) {
        const name = m[1]
        if (colors.has(name)) continue

        const wrong = KNOWN_WRONG.get(name)
        if (wrong) {
          bad.push(`${file.replace(SRC + '/', '')}: 「${name}」は定義されていません → ${wrong}`)
          continue
        }

        // 自分たちの語彙で始まるのに、定義に無い＝綴り違いか、存在しない変種。
        const family = OWN_FAMILIES.find((f) => name === f || name.startsWith(`${f}-`))
        if (family) {
          const candidates = [...colors].filter((c) => c.startsWith(family)).sort()
          bad.push(
            `${file.replace(SRC + '/', '')}: 「${name}」は定義されていません → ${candidates.join(' / ')}`,
          )
        }
      }
    }
    expect(
      [...new Set(bad)].sort(),
      [
        '定義されていない色の名前です。globals.css の @theme にあるものを使ってください。',
        'Tailwind は知らない名前を黙って捨てるので、書いても何も出ません。',
      ].join('\n'),
    ).toEqual([])
  })

  it('自分たちの角丸は、定義どおりの名前で書かれている', () => {
    const bad: string[] = []
    // rounded-card / rounded-t-control のような形だけを見る。
    // 数字や sm/lg などの組み込みは対象外。
    const re = new RegExp(
      `(?:^|[\\s"'\`{])${VARIANTS}rounded(?:-[trbl]{1,2})?-([a-z][a-z]*)(?=[\\s"'\`}])`,
      'g',
    )
    const builtIn = new Set(['none', 'sm', 'md', 'lg', 'xl', 'full', 't', 'b', 'l', 'r'])
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(re)) {
        const name = m[1]
        if (radii.has(name) || builtIn.has(name)) continue
        bad.push(
          `${file.replace(SRC + '/', '')}: 「rounded-${name}」は定義されていません → ${[...radii].sort().join(' / ')}`,
        )
      }
    }
    expect([...new Set(bad)].sort()).toEqual([])
  })
})
