/*
 * ★V8「枠線の色」`--color-control-border`（#868e98）の固定。
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
    expect(v8Block?.[1]).toContain('--color-control-border: #868e98')
    const rootBlock = globals.slice(0, globals.indexOf('[data-theme'))
    expect(rootBlock).not.toContain('--color-control-border')
  })

  it.each([
    ['入力欄', 'text-field.module.css', 'field'],
    ['選ぶ欄', 'select.module.css', 'trigger'],
    ['探す欄', 'search-field.module.css', 'search'],
    ['チェックの箱', 'checkbox.module.css', 'box'],
    ['入力（共通）', 'form-controls.module.css', 'control'],
    ['OTPのマス', 'otp-input.module.css', 'slot'],
    ['選ぶカードの○', 'radio-card.module.css', 'radio'],
    ['チェックのカードの箱', 'check-card.module.css', 'box'],
  ])('%s の枠が v8 で control-border になる', (_name, file, cls) => {
    const source = css(file)
    const re = new RegExp(`${V8}[^}]*\\.${cls}[^}]*\\{[^}]*border-color:\\s*var\\(--color-control-border\\)`)
    expect(source).toMatch(re)
  })

  it('色を選ぶの器と十六進の欄が v8 で control-border になる', () => {
    expect(css('color-well.module.css')).toMatch(
      new RegExp(`${V8}[^}]*\\.well[^}]*border-color:\\s*var\\(--color-control-border\\)`),
    )
    expect(css('color-well.module.css')).toMatch(
      new RegExp(`\\.hexField[^}]*\\{[^}]*var\\(--color-control-border\\)`),
    )
  })

  it('トグルのオフの地が v8 で control-border になる（消せない項目は灰のまま）', () => {
    const source = css('toggle.module.css')
    expect(source).toMatch(
      new RegExp(`${V8} \\.toggle[^}]*\\{[^}]*background:\\s*var\\(--color-control-border\\)`),
    )
    expect(source).toMatch(
      new RegExp(`${V8} \\.locked[^}]*\\{[^}]*background:\\s*var\\(--color-hairline\\)`),
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
