import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ★V8 の表の行の下の線は、絵では「線を含めて 1 行 62」（apLqS・uE9gf ほか）。
 *
 * border-bottom で引くと 1 行ごとに 1px 増え、6 行目で 5〜7px 下へずれる。
 * しかも CSS の読み込み順で Tailwind の `border: 0` に負けると線ごと消える
 * （2026-10-06：同じ本線でもリマインダ一覧は線あり 63・自動応答では線なし 62 だった）。
 * 行の内側に影で描けば、読み込み順に左右されず高さも増えない。
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'data-table.module.css'), 'utf8')
const globals = readFileSync(join(here, '..', '..', 'app', 'globals.css'), 'utf8')

describe('V8 の表：行の下の線は行の内側に描く', () => {
  it('セルの下線は border ではなく inset の影', () => {
    const rules = [...css.matchAll(/\[data-theme='v8'\] \.bodyCell \{([^}]*)\}/g)].map((m) => m[1])
    expect(rules.some((body) => /box-shadow: var\(--shadow-row-line\)/.test(body))).toBe(true)
    expect(globals).toMatch(/--shadow-row-line: inset 0 -1px 0 var\(--color-divider\);/)
    expect(rules.some((body) => /border-bottom: 1px solid/.test(body))).toBe(false)
  })
})
