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
  it('一覧が配列であることを確かめてから state に入れる', () => {
    expect(source).toContain('Array.isArray(eventRes.data)')
    expect(source).toContain('Array.isArray(settingRes.data)')
  })

  it('形の確認は setEvents より前に置く', () => {
    // 後ろに置くと、確かめる前に非配列が state に入って描画が落ちる。
    const guard = source.indexOf('Array.isArray(eventRes.data)')
    const assign = source.indexOf('setEvents(eventRes.data)')
    expect(guard).toBeGreaterThan(-1)
    expect(assign).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(assign)
  })

  it('読めなかった理由を本文に出す', () => {
    expect(source).toContain('ECデータ連携の情報を読み込めませんでした')
  })
})
