import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('プール作成のプレビュー', () => {
  it('入力中のURLと受け入れ先を右側で確認できる', () => {
    // 共通CardHeaderの見出しはcreate.test.tsxの実描画で確認する。
    expect(PAGE).toContain("/pool/${slugValid ? slug : 'shibuya'}")
    expect(PAGE).toContain("selectedAccounts.map((account) => account.name).join('・')")
  })

  it('#975 U066: 未入力のURLは「例」と明示し、発行済みに見せない', () => {
    expect(PAGE).not.toContain("/pool/{slug || 'shibuya'}")
    expect(PAGE).toContain("slugValid ? publicUrl : 'まだURLは発行されていません")
    expect(PAGE).toContain('まだURLは発行されていません')
  })

  it('#975 U074: 保存・キャンセルは共通の下部バー（キャンセル左・保存右）に従う', () => {
    // 採用済みの V8 設定画面の保存列でキャンセルを左に置く。
    expect(PAGE).toContain('savePlacement="content"')
    expect(PAGE.indexOf('>キャンセル</Button>')).toBeLessThan(PAGE.search(/保存してURLを発行\s*<\/Button>/))
    expect(PAGE).not.toContain('保存して続けて作る')
  })
})
