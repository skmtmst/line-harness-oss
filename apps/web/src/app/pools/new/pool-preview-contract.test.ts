import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('プール作成のプレビュー', () => {
  it('入力中のURLと受け入れ先を右側で確認できる', () => {
    expect(PAGE).toContain('>プレビュー</h2>')
    expect(PAGE).toContain("/pool/{slug || 'shibuya'}")
    expect(PAGE).toContain("{selectedAccount?.name ?? '未選択'}")
  })
})
