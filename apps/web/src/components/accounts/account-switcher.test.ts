import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./account-switcher.tsx', import.meta.url), 'utf8')

describe('店舗切り替え表示', () => {
  it('読み込み中と未選択を別の条件と文言で表示する', () => {
    expect(source).toContain('loading ? (')
    expect(source).toContain("!selectedAccount ? (")
    expect(source).toContain('読み込み中…')
    expect(source).toContain('店舗が選ばれていません')
  })

  it('未選択なら統括の店舗一覧へ移動できる', () => {
    expect(source).toContain('<Link href="/hq"')
    expect(source).toContain('統括の店舗一覧から選択')
  })
})
