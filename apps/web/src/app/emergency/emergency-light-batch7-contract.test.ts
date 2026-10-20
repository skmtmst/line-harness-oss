import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = ['page.tsx', '../../v8/emergency/control.tsx', '../../v8/settings/emergency/history-details.tsx', '../../v8/settings/emergency/screen.tsx'].map((file) => readFileSync(join(import.meta.dirname, file), 'utf8')).join('\n')

describe('点検・軽 第7便運用状態(#585)', () => {
  it('最終確認は低い画面でも閉じ込めない(#518 8)', () => {
    const dialogCss = readFileSync(join(import.meta.dirname, '../../components/shared/dialog.module.css'), 'utf8')
    expect(dialogCss).toMatch(/max-height:[^;]*(?:100dvh|100vh)/)
  })

  it('アカウント一覧の取得失敗は黙らせず読み直せる(#518 9)', () => {
    expect(PAGE).toContain('アカウント一覧を読み込めませんでした')
    expect(PAGE).toContain('もう一度読み込む')
    expect(PAGE).not.toContain('.catch(() => undefined)')
  })

  it('日付が読めない記録は数えて断る(#518 10)', () => {
    expect(PAGE).toContain('const unreadableEntries = operations.filter((item) => Number.isNaN(Date.parse(item.createdAt)))')
    expect(PAGE).toContain('期間の絞り込みから外しています')
  })
})
