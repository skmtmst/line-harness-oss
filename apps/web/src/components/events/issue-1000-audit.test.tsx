// @vitest-environment happy-dom
/*
  #1000 追加詳細監査(DETAIL-08/09/11)の回帰テスト。
  再現検査を正常動作の期待へ変えて固定したもの。
  元の検査: audit-reports/2026-09-20-detail-f26b550/evidence/tests/
    apps/web/src/components/events/audit-detail.test.tsx
*/
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import EventWizard from './event-wizard'
import { EVENT_DEFAULT_DRAFT } from './event-draft-shared'
import { EventSlotsPartialError } from '@/lib/api'

// api.ts は import 時に NEXT_PUBLIC_API_URL を要求する。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://worker.example.com'
})
const st = vi.hoisted(() => ({
  getEvent: vi.fn(),
  listSlots: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  createSlots: vi.fn(),
  updateSlot: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: st.push, replace: st.replace }) }))
vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...original,
    api: { tags: { list: async () => ({ success: true, data: [] }) } },
    eventsApi: st,
  }
})
vi.mock('@/components/shared/image-uploader', () => ({ default: () => null }))

let host: HTMLDivElement, root: Root
const ev = { ...EVENT_DEFAULT_DRAFT, id: 'event-1', name: 'Audit Event' }
const old = {
  id: 'old-slot', event_id: 'event-1',
  starts_at: '2026-09-22T05:00:00.000Z', ends_at: '2026-09-22T06:30:00.000Z',
  capacity: 12, is_active: 1, sort_order: 0, booked_count: 0,
}
const early = {
  ...old, id: 'early-slot',
  starts_at: '2026-09-21T01:00:00.000Z', ends_at: '2026-09-21T02:00:00.000Z',
  capacity: 7,
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  st.getEvent.mockResolvedValue(ev)
  st.createEvent.mockResolvedValue(ev)
  st.updateEvent.mockResolvedValue(ev)
  st.listSlots.mockResolvedValue({ items: [old] })
  st.createSlots.mockResolvedValue({ items: [early], created_count: 1, deduplicated_count: 0 })
  st.updateSlot.mockResolvedValue(old)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function render(step: 1 | 2 | 3, eventId: string | null = 'event-1') {
  await act(async () => root.render(<EventWizard accountId="account-a" eventId={eventId} step={step} />))
}
async function change(id: string, value: string) {
  await act(async () => { fireEvent.change(host.querySelector('#' + id)!, { target: { value } }) })
}
async function click(text: string) {
  const b = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)!
  expect(b).toBeTruthy()
  await act(async () => b.click())
}

it('D08: 定員0では作成/更新APIを一切呼ばない', async () => {
  await render(1, null)
  await change('ev-name', 'Audit Event')
  await change('first-slot-capacity', '0')
  await click('概要を保存して次へ')
  expect(host.textContent).toContain('定員は1以上')
  expect(st.createEvent).not.toHaveBeenCalled()
  expect(st.updateEvent).not.toHaveBeenCalled()
  expect(st.createSlots).not.toHaveBeenCalled()
  expect(st.updateSlot).not.toHaveBeenCalled()
})

it('D08: 日付が空でも作成/更新APIを呼ばない', async () => {
  await render(1, null)
  await change('ev-name', 'Audit Event')
  await change('first-slot-date', '')
  await click('概要を保存して次へ')
  expect(host.textContent).toContain('開催日と開始時刻を入力してください')
  expect(st.createEvent).not.toHaveBeenCalled()
  expect(st.createSlots).not.toHaveBeenCalled()
})

it('D08: 所要時間が不正でも作成/更新APIを呼ばない', async () => {
  await render(1, null)
  await change('ev-name', 'Audit Event')
  await change('first-slot-duration', '5')
  await click('概要を保存して次へ')
  expect(host.textContent).toContain('開催時間は15分以上')
  expect(st.createEvent).not.toHaveBeenCalled()
  expect(st.createSlots).not.toHaveBeenCalled()
})

it('D09: 早い日時の枠を追加して次へ進んでも既存枠を書き換えない', async () => {
  await render(2)
  await change('slot-date', '2026-09-21')
  await change('slot-start', '10:00')
  await change('slot-end', '11:00')
  await change('slot-cap', '7')
  st.listSlots.mockResolvedValue({ items: [early, old] })
  await click('この枠を追加')
  await click('保存して公開設定へ')
  // ②→③の保存はイベント設定だけ。枠一覧の追加とは分離し、
  // slots[0](=追加した早い枠)へ古い枠の日時・定員を送らない。
  expect(st.updateSlot).not.toHaveBeenCalled()
  expect(st.updateEvent).toHaveBeenCalledTimes(1)
})

it('D09: ①に戻って保存しても、更新先は概要段階で確定した枠IDだけ', async () => {
  await render(2)
  await change('slot-date', '2026-09-21')
  await change('slot-start', '10:00')
  await change('slot-end', '11:00')
  await change('slot-cap', '7')
  st.listSlots.mockResolvedValue({ items: [early, old] })
  await click('この枠を追加')
  // ①へ戻って保存。firstSlotの値は old-slot から読んだものなので、
  // 早い枠(early-slot)ではなく old-slot へだけ送る。
  await render(1, 'event-1')
  await click('概要を保存して次へ')
  expect(st.updateSlot).toHaveBeenCalledTimes(1)
  expect(st.updateSlot).toHaveBeenCalledWith(
    'account-a', 'event-1', 'old-slot',
    expect.objectContaining({ starts_at: old.starts_at, ends_at: old.ends_at, capacity: 12 }),
  )
})

it('D11: 一括追加の途中失敗後は、残りだけを再送する', async () => {
  await render(2)
  // 3枠をまとめて追加する下見を作る。初期曜日は土日のみなので木・金を足し、
  // 10/1(木)・10/2(金)・10/3(土)が一致するようにする。
  await change('bulk-start', '2026-10-01')
  await change('bulk-end', '2026-10-03')
  for (const label of ['木', '金']) {
    const b = Array.from(host.querySelectorAll('button')).find((x) => x.textContent?.trim() === label)!
    await act(async () => b.click())
  }
  // 時間帯を90分ちょうどにして1日1枠にする。
  await change('band-end', '15:30')
  await change('bulk-cap', '10')
  await click('まとめて追加')
  // 確認ダイアログは document.body への portal で描かれる。
  expect(document.body.textContent).toContain('3件の予約枠を追加しますか？')

  // 最初の送信は部分的に失敗したとみなす(1件だけ作成済み)。
  st.createSlots.mockRejectedValueOnce(
    new EventSlotsPartialError('1件まで追加されました', [early]),
  )
  const dialogClick = async (text: string) => {
    const b = Array.from(document.body.querySelectorAll('button'))
      .find((x) => x.textContent?.trim() === text)!
    expect(b).toBeTruthy()
    await act(async () => b.click())
  }
  await dialogClick('まとめて追加する')
  expect(document.body.textContent).toContain('1件は追加済みです')

  // 再送では成功済みの分を送り直さない。
  st.createSlots.mockResolvedValueOnce({ items: [early, early], created_count: 2, deduplicated_count: 0 })
  await dialogClick('まとめて追加する')
  const resent = st.createSlots.mock.calls.at(-1)![2] as Array<{ client_key?: string }>
  expect(resent.length).toBe(2)
  expect(resent.every((s) => typeof s.client_key === 'string' && s.client_key.length > 0)).toBe(true)
})
