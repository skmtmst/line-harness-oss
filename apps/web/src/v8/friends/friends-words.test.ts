// @vitest-environment happy-dom
/*
 * ★V8 友だち（src/v8/friends）の言葉・日付・権限の判定の試験。BEHAVIOR.md の決まりを守る。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lastContactOf, monthDayTime, splitTags, statusOf } from './list/words'
import { FRIENDS_TABS, hasEditKey } from './shared/nav'
import { STATUS_FILTERS, slashDateTime } from './duplicates/words'
import type { FriendListItem } from '@/lib/api'

describe('友だち一覧の言葉', () => {
  it('対応状況は受信箱と同じ4つの名前', () => {
    expect(statusOf('unread').label).toBe('未対応')
    expect(statusOf('in_progress').label).toBe('対応中')
    expect(statusOf('on_hold').label).toBe('保留')
    expect(statusOf('resolved').label).toBe('対応済み')
  })

  it('受信の時刻は記録の文字のまま（時差を足さない）', () => {
    const year = new Date().getFullYear()
    expect(monthDayTime(`${year}-08-14T07:58:00.000Z`)).toBe('8月14日 7:58')
    expect(monthDayTime('2020-01-02T10:05:00')).toBe('2020年1月2日 10:05')
    expect(monthDayTime('壊れた値')).toBe('—')
  })

  it('タグは短いものだけ2つ札にして、残りは +N', () => {
    expect(splitTags([{ name: 'VIP' }, { name: '定期便' }, { name: '紹介' }])).toEqual({ shown: [{ name: 'VIP' }, { name: '定期便' }], rest: 1 })
    expect(splitTags([{ name: '定期便の提案' }, { name: 'NEN会員' }, { name: 'B' }])).toEqual({ shown: [{ name: '定期便の提案' }], rest: 2 })
    expect(splitTags([])).toEqual({ shown: [], rest: 0 })
  })

  it('最終接触は受信と送信の新しい方', () => {
    const friend = {
      createdAt: '2026-01-01T00:00:00Z',
      latestIncomingMessage: { content: 'a', messageType: 'text', createdAt: '2026-02-01T00:00:00Z' },
      latestOutgoingAt: '2026-03-01T00:00:00Z',
    } as unknown as FriendListItem
    expect(lastContactOf(friend)).toBe('2026-03-01T00:00:00Z')
  })
})

describe('友だちのタブと権限', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => store.clear(),
      },
    })
  })
  afterEach(() => store.clear())

  it('タブは今と同じ行き先（UID移行は V8 の移行画面、CSV は /friends/migrations）', () => {
    expect(FRIENDS_TABS.map((tab) => [tab.label, tab.href])).toEqual([
      ['友だち一覧', '/friends'],
      ['重複検出', '/friends?tab=duplicates'],
      ['統合ユーザー', '/friends?tab=merged'],
      ['UID移行', '/friends/migrations?tab=uid'],
      ['CSVで書き出す・取り込む', '/friends/migrations'],
    ])
  })

  it('変更キーは担当者の項目キーだけを見る（手元の役割の保存値は見ない）', () => {
    window.localStorage.setItem('lh_staff_role', 'owner')
    window.localStorage.setItem('lh_staff_permissions', '[]')
    expect(hasEditKey('/friends')).toBe(false)
    window.localStorage.setItem('lh_staff_permissions', '["/friends"]')
    expect(hasEditKey('/friends')).toBe(true)
    window.localStorage.setItem('lh_staff_permissions', '壊れた値')
    expect(hasEditKey('/friends')).toBe(false)
  })
})

describe('重複検出の言葉', () => {
  it('状態の札は絵の順で、値は今の API と同じ', () => {
    expect(STATUS_FILTERS.map((filter) => filter.value)).toEqual(['', 'pending', 'deferred', 'linked', 'different'])
  })

  it('見直した時刻は日本時間の M/D HH:mm', () => {
    expect(slashDateTime('2026-08-30T10:00:00.000Z')).toBe('8/30 19:00')
  })
})
