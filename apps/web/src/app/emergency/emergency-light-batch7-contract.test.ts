import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = ['page.tsx', '../../v8/emergency/control.tsx', '../../v8/settings/emergency/history-details.tsx', '../../v8/settings/emergency/screen.tsx'].map((file) => readFileSync(join(import.meta.dirname, file), 'utf8')).join('\n')

/*
 * 運用状態の点検で直した3つ。動きは描いて見る：
 * - 最終確認の窓を低い画面でも閉じ込めない＝共通 Dialog の dialog-tall-panel-contract.test.tsx。
 * - アカウント一覧の取得失敗は黙らせず読み直せる＝v8/settings/emergency/screen.test.tsx。
 * - 日付が読めない記録は数えて断る＝operation-history-summary.test.tsx。
 * ここには失敗を黙らせる旧形へ戻らない見張りだけを残す。
 */
describe('運用状態の取得失敗を黙らせない', () => {
  it('取得の失敗を握りつぶす旧形へ戻らない', () => {
    expect(PAGE).not.toContain('.catch(() => undefined)')
  })
})
