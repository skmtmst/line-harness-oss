import { describe, expect, it } from 'vitest'
// 検証本体はNodeで直接実行する.mjs。公開型はこの回帰試験で固定する。
// @ts-expect-error .mjs用の宣言ファイルは持たない
import { builtRuleBody, frozenSelectorBody, normalize, resolveVars } from '../apps/web/scripts/verify-design-values.mjs'

describe('ビルド後CSSの設計照合', () => {
  it('最適化でカンマ結合された共通宣言も対象部品の宣言として読む', () => {
    const css = [
      '.breadcrumb_root__A1,.sticky-bar_actions__B2{display:flex;align-items:center;gap:8px}',
      '.breadcrumb_root__A1{min-width:0;color:#6e7781}',
    ].join('')

    expect(builtRuleBody(css, 'breadcrumb', 'root')).toContain('gap:8px')
    expect(builtRuleBody(css, 'breadcrumb', 'root')).toContain('color:#6e7781')
  })

  it('似た名前の別クラスを混ぜない', () => {
    const css = [
      '.breadcrumb_rootExtra__A1{gap:99px}',
      '.breadcrumb_root__B2:hover{gap:88px}',
      '.parent .breadcrumb_root__B2{gap:77px}',
      '.breadcrumb_root__B2[hidden]{gap:66px}',
      '.breadcrumb_root__B2{gap:8px}',
    ].join('')
    expect(builtRuleBody(css, 'breadcrumb', 'root')).toBe('gap:8px')
  })

  it('数の帯はビルド済みのV8指定で照合し、旧カードや狭い幅の別状態を混ぜない', () => {
    const css = [
      '.kpi-card_card__A1{box-shadow:var(--card-shadow)}',
      '[data-theme=v8] .kpi-card_strip__B2[data-kpi-presentation=band] .kpi-card_card__A1{box-shadow:none}',
      '[data-theme=v8] .kpi-card_strip__B2[data-kpi-presentation=band]>:not(:last-child){border-right:1px solid var(--tpl-band-line)}',
      '@container (max-width:500px){[data-theme=v8] .kpi-card_strip__B2[data-kpi-presentation=band]>:not(:last-child){border-right:0}}',
    ].join('')
    expect(builtRuleBody(css, 'kpi-card', 'card', "[data-theme='v8'] .strip[data-kpi-presentation='band'] .card")).toBe('box-shadow:none')
    expect(builtRuleBody(css, 'kpi-card', 'strip', '[data-theme=v8] .strip[data-kpi-presentation=band] > *:not(:last-child)')).toBe('border-right:1px solid var(--tpl-band-line)')
    expect(builtRuleBody(css, 'kpi-card', 'card', '[data-theme=v8] .strip[data-kpi-presentation=cards] .card')).toBe('')
  })
})


describe('未利用の部品のトークン照合', () => {
  it('CSS最適化で色の表記が変わっても同じ縁を比較し、色や透明度の差は検出する', () => {
    const snapshot = normalize('1px solid #1d1d1f14')
    expect(normalize('1px solid rgba(29, 29, 31, 0.08)')).toBe(snapshot)
    expect(normalize('1px solid rgba(29, 29, 31, 0.09)')).not.toBe(snapshot)
    expect(normalize('1px solid rgba(30, 29, 31, 0.08)')).not.toBe(snapshot)
    expect(normalize('rgb(255, 255, 255)')).toBe(normalize('#fff'))
  })
  it('トークンへの置き換えを許すが、解いた値のずれは通さない', () => {
    const snapshot = '1px solid #1d1d1f12'
    const declaration = '1px solid var(--color-hairline)'
    expect(normalize(resolveVars(declaration, { 'color-hairline': '#1d1d1f12' }))).toBe(normalize(snapshot))
    expect(normalize(resolveVars(declaration, { 'color-hairline': '#dadde2' }))).not.toBe(normalize(snapshot))
    expect(resolveVars('var(--undefined)', {})).toBe('var(--undefined)')
  })
})

describe('固定HTMLとV8の選択状態の照合', () => {
  it('選択中の合成クラスを読み、hover・未選択・別テーマの色を混ぜない', () => {
    const css = '.card{background:white}[data-theme="v8"] .checked{background:#e8f5ec}.checked:hover{background:black}[data-theme="v7"] .checked{background:blue}.parent .checked{background:red}'
    const body = frozenSelectorBody(css, '.card.checked')
    expect(body).toContain('background:#e8f5ec')
    expect(body).not.toMatch(/black|blue|red/)
  })

  it('ラジオの通常枠と選択枠を区別し、狭い幅の上書きを混ぜない', () => {
    const css = '.input{outline:1px solid gray}[data-theme="v8"] .input:checked{outline:1.5px solid green}.input:focus-visible{outline:2px solid blue}@media(max-width:600px){.input:checked{outline:5px solid red}}'
    expect(frozenSelectorBody(css, '.input:checked')).toContain('outline:1.5px solid green')
    expect(frozenSelectorBody(css, '.input')).not.toContain('solid green')
    expect(frozenSelectorBody(css, '.input:checked')).not.toMatch(/blue|red/)
  })
})
