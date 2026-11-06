import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../../v8/events/list.tsx', import.meta.url), 'utf8')
// cronからの実行は Worker cron-event-waitlist.test.ts、回収は event-waitlist.test.ts で守る。
const WAITLIST = readFileSync(new URL('../../../../worker/src/services/event-waitlist.ts', import.meta.url), 'utf8')

describe('V8 イベント予約の件数状態', () => {
  it('読込中・失敗・成功を同じ補足にしない', () => {
    expect(PAGE).toContain("loadStatus === 'loading' ? emptyValue('unknown')")
    expect(PAGE).toContain("loadStatus === 'ready' ? ready : '読み込めませんでした'")
  })

  it('失敗時は一覧件数を0件とせずページ送りを出さない', () => {
    expect(PAGE).toContain('value: dataReady ? kpi.upcoming_slots : null')
    expect(PAGE).toContain('!dataReady || items.length === 0 ? null')
    expect(PAGE).toContain('<Pagination')
  })

  it('取得成功後の実値0は集計と空の一覧として表示できる', () => {
    expect(PAGE).toContain('items.length === 0')
    expect(PAGE).toContain('<EmptyList')
    expect(PAGE).toContain('value: dataReady ? kpi.upcoming_active : null')
  })

  it('全体平均でなく、次に声をかける回を帯へ出す', () => {
    expect(PAGE).toContain("title: 'これからの回'")
    expect(PAGE).toContain("title: 'あと少しで満席'")
    expect(PAGE).toContain('声をかけると埋まります')
    expect(PAGE).toContain("title: '申し込みが少ない'")
    expect(PAGE).toContain('daysUntilIso(kpi.nearest_low_starts_at)')
    expect(PAGE).not.toContain('title="定員の充足"')
  })

  it('終わった回は端末時計で数えず、重複する集計帯ごと出さない(点検#520軽16)', () => {
    // 下の集計カードと同じ数字は重複させない。終わった回は数えない。
    expect(PAGE).not.toContain('一覧の集計（表示のみ）')
    expect(PAGE).not.toContain('終わった回 <strong')
    expect(PAGE).not.toContain('endedCount')
  })

  it('席が空いたあとの自動案内を、実際の定期処理があるときだけ案内する', () => {
    expect(PAGE).toContain('キャンセルが出たら、キャンセル待ちの人に自動で順番が回ります。')
    expect(WAITLIST).toContain('enqueueEventWaitlistPromotion')
    expect(WAITLIST).toContain('DEFAULT_OFFER_HOURS = 24')
  })
})
