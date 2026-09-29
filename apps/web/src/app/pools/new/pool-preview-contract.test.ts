import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('プール作成のプレビュー', () => {
  it('入力中のURLと受け入れ先を右側で確認できる', () => {
    expect(PAGE).toContain('>プレビュー</h2>')
    expect(PAGE).toContain('/pool/{slug}')
    expect(PAGE).toContain("{selectedAccount?.name ?? '未選択'}")
  })

  it('#975 U066: 未入力のURLは「例」と明示し、発行済みに見せない', () => {
    expect(PAGE).not.toContain("/pool/{slug || 'shibuya'}")
    expect(PAGE).toContain('例: /pool/shibuya')
    expect(PAGE).toContain('まだURLは発行されていません')
  })

  it('#975 U074: 保存・キャンセルは共通の下部バー（キャンセル左・保存右）に従う', () => {
    // variant="v6" で CreatePage の共通アクション列（キャンセル→保存）を使う。
    expect(PAGE).toContain('variant="v6"')
    expect(PAGE).not.toContain('保存して続けて作る')
  })
})
