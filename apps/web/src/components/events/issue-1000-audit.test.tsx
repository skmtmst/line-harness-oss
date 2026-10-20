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
import EventForm, { formatJpSlotRange } from '@/v8/events/edit-form'
import EventsCreate from '@/v8/events/create'
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
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), useRouter: () => ({ push: st.push, replace: st.replace }) }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, accounts: [] }) }))
vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...original,
    api: { ...original.api, tags: { list: async () => ({ success: true, data: [] }) }, staff: { ...original.api.staff, me: vi.fn().mockResolvedValue({ success: true, data: { id: 'me', role: 'owner', isActive: true } }) } },
    eventsApi: st,
  }
})
vi.mock('@/components/shared/image-uploader', () => ({ default: () => null }))

/*
 * 時刻の選び欄は共通 Select（listbox）。ここで見たいのは選んだ後の
 * 予約枠の判断なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

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
  document.documentElement.dataset.theme = 'v8'
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
  delete document.documentElement.dataset.theme
})

async function renderSlots() {
  await act(async () => root.render(<EventForm accountId="account-a" eventId="event-1" />))
  await click('2. 予約枠')
}
async function change(id: string, value: string) {
  await act(async () => { fireEvent.change(document.querySelector('#' + id)!, { target: { value } }) })
}

/** 日付の選択（★管理画面）で YYYY-MM-DD を選ぶ。値は今までどおりの文字列。 */
async function pickDate(id: string, iso: string) {
  const [y, mo, d] = iso.split('-').map(Number)
  const week = '日月火水木金土'[new Date(y, mo - 1, d).getDay()]
  await act(async () => { fireEvent.click(document.getElementById(id) ?? document.querySelector(`[aria-label="${id}"]`)!) })
  for (let i = 0; i < 36; i += 1) {
    const grid = document.querySelector('[role="grid"]')
    const label = grid?.getAttribute('aria-label')
    if (label === `${y}年${mo}月`) break
    const target = y * 12 + mo
    const currentLabel = /^(\d+)年(\d+)月$/.exec(label ?? '')
    const current = currentLabel ? Number(currentLabel[1]) * 12 + Number(currentLabel[2]) : target
    const nav = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === (target > current ? '次の月' : '前の月'),
    )!
    await act(async () => { fireEvent.click(nav) })
  }
  const day = [...document.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith(`${y}年${mo}月${d}日（${week}）`),
  )!
  await act(async () => { fireEvent.click(day) })
}

/** 時刻の選択（★管理画面）で HH:mm を選ぶ。 */
async function pickTime(id: string, hhmm: string) {
  const field = document.getElementById(id) ?? document.querySelector(`[aria-label="${id}"]`)!
  if (field instanceof HTMLInputElement) {
    await act(async () => { fireEvent.change(field, { target: { value: hhmm } }) })
    await act(async () => { fireEvent.blur(field) })
    return
  }
  const [hour, minute] = hhmm.split(':')
  await act(async () => { fireEvent.click(field) })
  const picker = document.querySelector('[role="dialog"][aria-label="時刻を選ぶ"]')!
  await act(async () => {
    fireEvent.change(picker.querySelector('select[aria-label="時"]')!, { target: { value: hour } })
  })
  await act(async () => {
    fireEvent.change(picker.querySelector('select[aria-label="分"]')!, { target: { value: minute } })
  })
  await act(async () => { fireEvent.keyDown(picker, { key: 'Escape' }) })
}

/** 日付の選択を空にする。 */
async function clearDate(id: string) {
  await act(async () => { fireEvent.click(document.querySelector('#' + id)!) })
  const dialog = document.querySelector('[role="dialog"][aria-label="日付を選ぶ"]')!
  const clear = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === '消す')!
  await act(async () => { fireEvent.click(clear) })
}
async function click(text: string) {
  const b = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)!
  expect(b).toBeTruthy()
  await act(async () => b.click())
}

it('D08: 定員0では作成/更新APIを一切呼ばない', async () => {
  await act(async () => root.render(<EventsCreate />))
  await change('ev-new-name', 'Audit Event')
  await change('ev-new-cap', '0')
  await click('下書きを保存')
  expect(host.textContent).toContain('定員は1以上')
  expect(st.createEvent).not.toHaveBeenCalled()
  expect(st.updateEvent).not.toHaveBeenCalled()
  expect(st.createSlots).not.toHaveBeenCalled()
  expect(st.updateSlot).not.toHaveBeenCalled()
})

it('D08: 日付が空でも作成/更新APIを呼ばない', async () => {
  await act(async () => root.render(<EventsCreate />))
  await change('ev-new-name', 'Audit Event')
  await change('ev-new-cap', '10')
  await clearDate('ev-new-date')
  await click('下書きを保存')
  expect(host.textContent).toContain('日付を選んでください')
  expect(st.createEvent).not.toHaveBeenCalled()
  expect(st.createSlots).not.toHaveBeenCalled()
})

it('D08: 所要時間が不正でも作成/更新APIを呼ばない', async () => {
  await act(async () => root.render(<EventsCreate />))
  await change('ev-new-name', 'Audit Event')
  await change('ev-new-cap', '10')
  await pickTime('ev-new-end', '14:05')
  await click('下書きを保存')
  expect(host.textContent).toContain('開催時間は15分以上')
  expect(st.createEvent).not.toHaveBeenCalled()
  expect(st.createSlots).not.toHaveBeenCalled()
})

async function addEarlierSlot() {
  await click('＋ 枠を追加する')
  await pickDate('日付（JST）', '2026-09-21')
  await pickTime('開始', '10:00')
  await pickTime('終了', '11:00')
  await act(async () => { fireEvent.change(document.querySelector('[role="dialog"] input[type="number"]')!, { target: { value: '7' } }) })
  st.listSlots.mockResolvedValue({ items: [early, old] })
  await click('追加する')
}

it('D09: 早い日時の枠を追加して公開設定を保存しても既存枠を書き換えない', async () => {
  await renderSlots()
  await addEarlierSlot()
  expect(st.createSlots).toHaveBeenCalledWith('account-a', 'event-1', [expect.objectContaining({ starts_at: early.starts_at, ends_at: early.ends_at, capacity: 7 })])
  await click('3. 公開設定')
  await click('公開設定を保存する')
  expect(st.updateSlot).not.toHaveBeenCalled()
  expect(st.updateEvent).toHaveBeenCalledTimes(1)
})

it('D09: 早い枠が先頭へ入っても、選んだ元の枠IDだけを更新する', async () => {
  await renderSlots()
  await addEarlierSlot()
  const row = [...host.querySelectorAll('tbody tr')].find((row) => row.textContent?.includes(formatJpSlotRange(old.starts_at, old.ends_at)))!
  await act(async () => { (row.querySelector('[aria-label="そのほかの操作"]') as HTMLButtonElement).click() })
  await act(async () => { (document.querySelector('[role="menuitem"]') as HTMLButtonElement).click() })
  await click('保存する')
  await click('1. 概要')
  await click('概要を保存する')
  expect(st.updateSlot).toHaveBeenCalledTimes(1)
  expect(st.updateSlot).toHaveBeenCalledWith('account-a', 'event-1', 'old-slot', expect.objectContaining({ starts_at: old.starts_at, ends_at: old.ends_at, capacity: 12 }), 1)
  expect(st.updateSlot.mock.calls[0][2]).not.toBe('early-slot')
})

it('D11: 一括追加の途中失敗後は、残りだけを同じ鍵で再送する', async () => {
  await renderSlots()
  await click('一括追加する')
  await pickDate('開始日', '2026-10-01')
  await pickDate('終了日', '2026-10-03')
  await click('土')
  await act(async () => { document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click() })
  await pickTime('時間帯の終了', '15:30')
  await act(async () => { fireEvent.change(document.querySelector('[role="dialog"] input[type="number"]')!, { target: { value: '10' } }) })
  await click('生成')
  expect(document.body.textContent).toContain('3件の予約枠を作りますか？')
  expect(st.createSlots).not.toHaveBeenCalled()
  st.createSlots.mockRejectedValueOnce(new EventSlotsPartialError('1件まで追加されました', [early]))
  await click('まとめて作る')
  expect(document.body.textContent).toContain('1件は追加済みです')
  const original = st.createSlots.mock.calls[0][2] as Array<{ client_key: string }>
  expect(original).toHaveLength(3)
  st.createSlots.mockResolvedValueOnce({ items: [early, early], created_count: 2, deduplicated_count: 0 })
  await click('まとめて作る')
  const resent = st.createSlots.mock.calls.at(-1)![2] as Array<{ client_key: string }>
  expect(st.createSlots).toHaveBeenCalledTimes(2)
  expect(resent).toEqual(original.slice(1))
  expect(new Set(original.map((slot) => slot.client_key)).size).toBe(3)
  expect(resent.every((slot) => typeof slot.client_key === 'string' && slot.client_key.length > 0)).toBe(true)
})
