import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')

describe('点検・軽 第7便運用状態(#585)', () => {
  it('補足は1000文字の上限と残り字数を見せる(#518 7)', () => {
    expect(PAGE).toContain('maxLength={1000}')
    expect(PAGE).toContain('あと{1000 - reasonDetail.length}文字')
  })

  it('最終確認は低い画面でも閉じ込めない(#518 8)', () => {
    expect(PAGE).toContain("maxHeight: 'calc(100vh - 32px)'")
  })

  it('アカウント一覧の取得失敗は黙らせず読み直せる(#518 9)', () => {
    expect(PAGE).toContain('アカウント一覧を取得できませんでした')
    expect(PAGE).toContain('もう一度読む')
    expect(PAGE).not.toContain('.catch(() => undefined)')
  })

  it('日付が読めない記録は数えて断る(#518 10)', () => {
    expect(PAGE).toContain('const unreadableEntries = operations.filter((item) => Number.isNaN(Date.parse(item.createdAt)))')
    expect(PAGE).toContain('期間の絞り込みから外しています')
  })
})
