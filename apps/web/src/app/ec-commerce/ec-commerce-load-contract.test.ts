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
  it('集計と取込一覧を別々に読み込み、片方の失敗で両方を消さない', () => {
    expect(source).toContain('const loadOverview = useCallback')
    expect(source).toContain('const loadRecords = useCallback')
    expect(source).toContain('setOverviewState')
    expect(source).toContain('setListState')
    expect(source).not.toContain('Promise.all([')
  })

  it('取込一覧の形を確かめてからstateへ入れる', () => {
    const guard = source.indexOf('Array.isArray(response.data?.items)')
    const assign = source.indexOf('setActions(response.data.items)')
    expect(guard).toBeGreaterThan(-1)
    expect(assign).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(assign)
  })

  it('失敗箇所と、それぞれの再読み込み操作を本文に出す', () => {
    expect(source).toContain('集計だけを読み込めませんでした')
    expect(source).toContain('集計をもう一度読む')
    expect(source).toContain('取り込みの記録を読み込めませんでした')
    expect(source).toContain('onRetry={listState')
  })
})
