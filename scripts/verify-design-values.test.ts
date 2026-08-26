import { describe, expect, it } from 'vitest'
// 検証本体はNodeで直接実行する.mjs。公開型はこの回帰試験で固定する。
// @ts-expect-error .mjs用の宣言ファイルは持たない
import { builtRuleBody } from '../apps/web/scripts/verify-design-values.mjs'

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
})
