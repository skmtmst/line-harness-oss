/*
 * `/ec-commerce`（設計 `eI3gs`）が、一覧を読めなかったときに
 * **本文ごと消えない**ことの契約。
 *
 * 起きたこと（2026-09-02）: `api.ecCommerce.events` の返事が配列でないと、
 * `success` が真のまま非配列が state に入り、描画の途中で
 * `events.map is not a function` を投げていた。エラー境界が本文を丸ごと
 * 「画面を表示できませんでした」に差し替えるので、**撮ると空の絵になる。**
 * 上の口ひとつが読めないだけで、KPI もイベント履歴も設定も全部消える。
 *
 * 形を確かめてから state に入れ、読めなければ理由を帯に出す、を見張る。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('V6 23-1 EC連携の読み込み', () => {
  it('注文と個別処理が配列であることを確かめてから state に入れる', () => {
    expect(source).toContain('Array.isArray(ordersResponse.data?.items)')
    expect(source).toContain('Array.isArray(actionsResponse.data?.items)')
    expect(source).toContain("typeof overviewResponse.data === 'object'")
    expect(source).toContain('!Array.isArray(overviewResponse.data)')
  })

  it('形の確認は注文と処理を state に入れるより前に置く', () => {
    // 後ろに置くと、確かめる前に非配列が state に入って描画が落ちる。
    for (const [guardText, assignText] of [
      ['Array.isArray(ordersResponse.data?.items)', 'setOrders(ordersResponse.data.items)'],
      ['Array.isArray(actionsResponse.data?.items)', 'setActions(actionsResponse.data.items)'],
    ]) {
      const guard = source.indexOf(guardText)
      const assign = source.indexOf(assignText)
      expect(guard).toBeGreaterThan(-1)
      expect(assign).toBeGreaterThan(-1)
      expect(guard).toBeLessThan(assign)
    }
  })

  it('読めなかった理由を本文に出す', () => {
    expect(source).toContain('ECデータ連携の情報を読み込めませんでした')
  })
})
