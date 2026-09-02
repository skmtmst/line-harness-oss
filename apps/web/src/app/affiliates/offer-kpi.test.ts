import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ConversionApprovalItem } from '@/lib/api'
import {
  confirmedDetail,
  confirmedThisMonth,
  confirmedTotals,
  confirmedUnit,
  confirmedValue,
  jstMonthKey,
} from './offer-kpi'

const TABS = readFileSync(new URL('./tabs.tsx', import.meta.url), 'utf8')

/**
 * **ファイル全体を `toContain` で見ない。** 別の関数に同じ字が
 * 残っているだけで通ってしまう。ここでは `OffersTab` の中身と、
 * KPIの帯そのものを切り出して見る。
 */
function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  expect(from, `${start} が見つからない`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to, `${end} が見つからない`).toBeGreaterThan(from)
  return source.slice(from, to)
}

const OFFERS_TAB = sliceBetween(TABS, 'export function OffersTab() {', '\nfunction SettlementEditor')
/** 注記は画面の字なので `tabs.tsx` にある。設計照合もそこを読む。 */
const CONFIRMED_DETAIL = sliceBetween(TABS, 'const CONFIRMED_DETAIL = {', '} as const')

const KPI_BAND = sliceBetween(
  OFFERS_TAB,
  '<div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">',
  '</div>\n\n      <div',
)

function approval(over: Partial<ConversionApprovalItem> & { eventId: string }): ConversionApprovalItem {
  return {
    createdAt: '2026-09-02T10:00:00.000+09:00',
    friendId: 'f1',
    friendName: null,
    affiliateId: 'af1',
    affiliateName: null,
    offerId: null,
    offerName: null,
    offerRewardMiles: null,
    conversionPointName: null,
    value: null,
    approvalStatus: 'approved',
    duplicateFlag: false,
    ...over,
  }
}

describe('今月の年月はJSTで数える', () => {
  it('JSTで月が変わった直後（UTCではまだ前月）でも、今月として数える', () => {
    // 2026-09-01 00:30 JST = 2026-08-31 15:30 UTC。
    const jstJustAfterMonthStart = Date.parse('2026-09-01T00:30:00+09:00')
    expect(new Date(jstJustAfterMonthStart).toISOString().slice(0, 7)).toBe('2026-08')
    expect(jstMonthKey(jstJustAfterMonthStart)).toBe('2026-09')
  })

  it('JSTの月末直前は、UTCの翌月へこぼさない', () => {
    expect(jstMonthKey(Date.parse('2026-09-30T23:30:00+09:00'))).toBe('2026-09')
  })

  it('+09:00 の時刻もZの時刻も、JSTの月へそろえる', () => {
    expect(jstMonthKey('2026-09-01T00:30:00.000+09:00')).toBe('2026-09')
    expect(jstMonthKey('2026-08-31T15:30:00.000Z')).toBe('2026-09')
  })

  it('読めない日時は空にする。勝手な月を作らない', () => {
    expect(jstMonthKey('not-a-date')).toBe('')
  })
})

describe('今月の成果は「承認が済んだ分」だけを数える', () => {
  const now = Date.parse('2026-09-02T12:00:00+09:00')

  it('承認待ち・却下は数に入れない', () => {
    const items = [
      approval({ eventId: 'a' }),
      approval({ eventId: 'b', approvalStatus: 'pending' }),
      approval({ eventId: 'c', approvalStatus: 'rejected' }),
    ]
    expect(confirmedThisMonth(items, now).map((i) => i.eventId)).toEqual(['a'])
  })

  it('先月に起きた成果は今月に入れない', () => {
    const items = [
      approval({ eventId: 'a' }),
      approval({ eventId: 'old', createdAt: '2026-08-31T23:00:00.000+09:00' }),
    ]
    expect(confirmedThisMonth(items, now).map((i) => i.eventId)).toEqual(['a'])
  })

  it('JSTで今月に入ったばかりの成果を落とさない', () => {
    const items = [approval({ eventId: 'a', createdAt: '2026-09-01T00:30:00.000+09:00' })]
    expect(confirmedThisMonth(items, Date.parse('2026-09-01T01:00:00+09:00'))).toHaveLength(1)
  })

  it('件数・円・マイルを足す。値が無い行は0として足す', () => {
    const totals = confirmedTotals([
      approval({ eventId: 'a', value: 500, offerRewardMiles: 10 }),
      approval({ eventId: 'b', value: null, offerRewardMiles: null }),
    ])
    expect(totals).toEqual({ count: 2, yen: 500, miles: 10 })
  })

  it('1件も無ければ0。0は0のまま出す', () => {
    expect(confirmedTotals([])).toEqual({ count: 0, yen: 0, miles: 0 })
  })
})

describe('取れた0と、取れていないものを混ぜない', () => {
  it('読み込めていれば数を出す。0も数として出す', () => {
    expect(confirmedValue('ready', 0)).toBe(0)
    expect(confirmedUnit('ready', '件')).toBe('件')
    expect(confirmedDetail('ready', '確定した件数（承認待ちは含みません）'))
      .toBe('確定した件数（承認待ちは含みません）')
  })

  it('読み込み中は数を出さず、読み込んでいると言う', () => {
    expect(confirmedValue('loading', 0)).toBeNull()
    expect(confirmedDetail('loading', '確定した件数（承認待ちは含みません）')).toBe('読み込んでいます')
  })

  it('取得に失敗したら0件と言わず、読み込めなかったと言う', () => {
    expect(confirmedValue('error', 0)).toBeNull()
    expect(confirmedDetail('error', '確定した件数（承認待ちは含みません）')).toBe('読み込めませんでした')
  })

  it('数が出ないときは単位を付けない。「—件」は数に見える', () => {
    expect(confirmedUnit('loading', '件')).toBe('')
    expect(confirmedUnit('error', '円')).toBe('')
  })

  it('注記は3つとも「承認待ちを含まない」ことを言う', () => {
    const lines = CONFIRMED_DETAIL.split('\n').filter((line) => line.includes(':'))
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(line).toContain('承認待ちは含みません')
  })

  it('設計の字（確定した件数・確定した報酬の合計・報酬をマイルで払う分）を落とさない', () => {
    for (const word of ['確定した件数', '確定した報酬の合計', '報酬をマイルで払う分']) {
      expect(CONFIRMED_DETAIL).toContain(word)
    }
  })
})

describe('V6 案件一覧（GH8VL）のKPIの帯', () => {
  it('3枚とも状態つきの値・単位・注記を通す。素の数を直接置かない', () => {
    for (const title of ['今月の成果', '支払い予定', '付与予定マイル']) {
      expect(KPI_BAND).toContain(`title="${title}"`)
    }
    expect(KPI_BAND.match(/confirmedValue\(confirmedState,/g) ?? []).toHaveLength(3)
    expect(KPI_BAND.match(/confirmedUnit\(confirmedState,/g) ?? []).toHaveLength(3)
    expect(KPI_BAND.match(/confirmedDetail\(confirmedState,/g) ?? []).toHaveLength(3)
    expect(KPI_BAND.match(/loading=\{confirmedState === 'loading'\}/g) ?? []).toHaveLength(3)
  })

  it('「確定した件数」だけの注記を帯に残さない', () => {
    expect(KPI_BAND).not.toContain('detail="確定した件数"')
    expect(KPI_BAND).not.toContain('detail="確定した報酬の合計"')
    expect(KPI_BAND).not.toContain('detail="報酬をマイルで払う分"')
  })

  it('公開中の案件は読み込んだ行から数えるので、状態を付けない', () => {
    expect(KPI_BAND).toContain('title="公開中の案件" value={openCount} unit="件"')
  })

  it('承認の取得が落ちたら error にする。黙って0のままにしない', () => {
    expect(OFFERS_TAB).toContain("setConfirmedState('error')")
    expect(OFFERS_TAB).toContain("setConfirmedState('ready')")
    expect(OFFERS_TAB).not.toContain("new Date().toISOString().slice(0, 7)")
  })
})
