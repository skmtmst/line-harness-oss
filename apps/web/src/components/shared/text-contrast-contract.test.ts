import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 文字色と面の組み合わせを、トークンの値から計算して見張る（WCAG AA 4.5:1）。
 *
 * 2026-09-24 の点検（axe・better-interface）で、次が全画面に出ていた。
 *   - 薄い灰色の文字 #6e7781 を灰色の面に置くと 3.9〜4.4:1
 *   - 成功の緑 #05913e の文字は白地 4.1:1・薄緑の地 3.7:1
 *   - LINE の緑 #06c755 を文字色（text-accent）にすると白地 2.25:1、薄緑の地 2.05:1
 * トークンの値を濃くし、`text-accent` は `text-accent-deep` へ置き換えた。
 */

const SRC = join(__dirname, '..', '..')
const GLOBALS = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8')

function token(name: string): string {
  const match = GLOBALS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`))
  if (!match) throw new Error(`--color-${name} が見つからない`)
  return match[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function files(dir: string, test: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, test, out)
    else if (test(name) && !name.includes('.test.')) out.push(path)
  }
  return out
}

const SURFACES = ['canvas', 'canvas-sunken', 'surface-pearl', 'shell', 'surface-chrome', 'accent-soft', 'success-bg']

describe('文字色は、置かれる面の上で 4.5:1 以上', () => {
  for (const text of ['ink-faint', 'ink-secondary', 'success', 'accent-deep']) {
    for (const surface of SURFACES) {
      it(`${text} on ${surface}`, () => {
        expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('LINE の緑は文字色に使わない', () => {
  it('画面のクラスに text-accent・text-accent-hover（-deep・-soft 以外）が無い', () => {
    const hits = files(SRC, (n) => /\.tsx?$/.test(n))
      .flatMap((path) => readFileSync(path, 'utf8').split('\n').map((line, i) => ({ path, line, i })))
      .filter(({ line }) => /(?<![\w-])(?:[\w-]+:)*text-(?:v6-)?accent(?:-hover)?(?![\w-])/.test(line))
      .map(({ path, i }) => `${path.replace(SRC, '')}:${i + 1}`)
    expect(hits, 'text-accent-deep にしてください').toEqual([])
  })

  it('CSS の文字色に var(--color-accent) を使わない', () => {
    const hits = files(SRC, (n) => n.endsWith('.css'))
      .filter((path) => /(?<![\w-])color:\s*var\(--color-accent\s*[,)]/.test(readFileSync(path, 'utf8')))
      .map((path) => path.replace(SRC, ''))
    expect(hits, 'var(--color-accent-deep) にしてください').toEqual([])
  })
})
