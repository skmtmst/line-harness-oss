/*
 * ★V8「枠線の色」`--color-control-border`（B-150 案1：黒12%＋薄い影）の固定。
 *
 *   - V8（`[data-theme="v8"]`）のときだけ効くトークンであること
 *   - 操作する部品（入力・選ぶ欄・探す欄・チェック・ラジオ・
 *     トグルのオフ・OTP・色を選ぶ・カードの中の印）に効くこと
 *   - カード・表・外側の板の枠は hairline のままであること
 *   - 選択中の緑・誤りの赤・無効の灰は v8 でも保つこと
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB = join(__dirname, '..', '..')
const SHARED = join(WEB, 'src/components/shared')
const css = (name: string) => readFileSync(join(SHARED, name), 'utf8')
const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8')

const V8 = String.raw`\[data-theme=['"]?v8['"]?\]`

describe('★V8 枠線の色（--color-control-border）', () => {
  it('トークンが v8 の下にだけ定義されている', () => {
    const v8Block = globals.match(/\[data-theme="v8"\]\s*\{([^}]*)\}/)
    expect(v8Block?.[1]).toContain('--color-control-border: #1d1d1f1f')
    expect(v8Block?.[1]).toContain('--control-shadow: 0 1px 2px rgba(29, 29, 31, 0.06)')
    expect(v8Block?.[1]).toContain('--color-choice-border: #c9ced6')
    const rootBlock = globals.slice(0, globals.indexOf('[data-theme'))
    expect(rootBlock).not.toContain('--color-control-border')
  })

  it.each([
    ['入力欄', 'text-field.module.css', 'field'],
    ['選ぶ欄', 'select.module.css', 'trigger'],
    ['探す欄', 'search-field.module.css', 'search'],
    ['OTPのマス', 'otp-input.module.css', 'slot'],
  ])('%s の枠が v8 で control-border になる', (_name, file, cls) => {
    const source = css(file)
    const re = new RegExp(`${V8}[^}]*\\.${cls}[^}]*\\{[^}]*border-color:\\s*var\\(--color-control-border\\)`)
    expect(source).toMatch(re)
  })

  it.each([
    ['チェック', 'checkbox.module.css', 'box'],
    ['ラジオ', 'radio-card.module.css', 'radio'],
    ['チェックのカード', 'check-card.module.css', 'box'],
  ])('%s の枠は元の色を保つ', (_name, file, cls) => {
    expect(css(file)).toMatch(new RegExp(`${V8}[^}]*\\.${cls}[^}]*\\{[^}]*border-color:\\s*var\\(--color-choice-border\\)`))
    expect(css(file)).not.toContain('var(--color-control-border)')
  })

  it.each([
    'text-field.module.css', 'select.module.css', 'search-field.module.css',
    'combobox.module.css', 'multi-select.module.css', 'date-field.module.css',
    'time-field-v8.module.css', 'button.module.css', 'filter-chip.css',
  ])('%s の基本の器は共通の薄い影を読む', (file) => {
    expect(css(file)).toContain('box-shadow: var(--control-shadow)')
  })

  it('色を選ぶの器と十六進の欄が v8 で control-border になる', () => {
    expect(css('color-well.module.css')).toMatch(
      new RegExp(`${V8}[^}]*\\.well[^}]*border-color:\\s*var\\(--color-control-border\\)`),
    )
    expect(css('color-well.module.css')).toMatch(
      new RegExp(`\\.hexField[^}]*\\{[^}]*var\\(--color-control-border\\)`),
    )
  })

  it('トグルのオフの地は choice-border のまま保つ（消せない項目は灰のまま）', () => {
    const source = css('toggle.module.css')
    expect(source).toMatch(
      new RegExp(`${V8} \\.toggle[^}]*\\{[^}]*background:\\s*var\\(--color-choice-border\\)`),
    )
    expect(source).toMatch(
      new RegExp(`${V8} \\.locked[^}]*\\{[^}]*background:\\s*var\\(--color-toggle-locked\\)`),
    )
  })

  it('選択中の緑・誤りの赤を v8 で上書き直して保つ', () => {
    expect(css('radio-card.module.css')).toMatch(
      new RegExp(`${V8} \\.radio:checked[^}]*border-color:\\s*var\\(--color-accent-deep\\)`),
    )
    expect(css('check-card.module.css')).toMatch(
      new RegExp(`${V8} \\.box:checked[^}]*border-color:\\s*var\\(--color-accent-deep\\)`),
    )
    expect(css('otp-input.module.css')).toMatch(
      new RegExp(`${V8} \\.slot\\[aria-invalid='true'\\][^}]*border-color:\\s*var\\(--color-status-danger\\)`),
    )
    expect(css('text-field.module.css')).toMatch(
      new RegExp(`${V8} \\.invalid[^}]*border-color:\\s*var\\(--color-status-danger\\)`),
    )
  })
})
