// @vitest-environment happy-dom
/*
  追加47件イベント予約領域（EVENT-01/02/03/04）の回帰テスト。
  監査で再現した症状を、正常動作の期待として固定したもの。
    - EVENT-01: ①で枠を更新して②へ進むと、一覧・残席が古いままだった
    - EVENT-02: 公開OFFでも主ボタンが「保存して公開」だった
    - EVENT-03: 取消期限の null が作成=「いつでも」・編集/API=「不可」で逆
    - EVENT-04: 締切の保存値2が編集の選択肢に無く「開始まで」に見えた
*/
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import EventWizard from './event-wizard'
import { EVENT_DEFAULT_DRAFT } from './event-draft-shared'

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
const slot = {
  id: 'slot-1', event_id: 'event-1',
  starts_at: '2026-10-01T05:00:00.000Z', ends_at: '2026-10-01T06:30:00.000Z',
  capacity: 1, is_active: 1, sort_order: 0, active_count: 0,
}
const slotCap2 = { ...slot, capacity: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  st.getEvent.mockResolvedValue(ev)
  st.createEvent.mockResolvedValue(ev)
  st.updateEvent.mockResolvedValue(ev)
  st.listSlots.mockResolvedValue({ items: [slot] })
  st.createSlots.mockResolvedValue({ items: [slot] })
  st.updateSlot.mockResolvedValue(slotCap2)
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
function buttonLabels(): string[] {
  return Array.from(host.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '')
}

it('EVENT-01: ①で枠の定員を保存→②へ進むと一覧・残席が新しい値になる', async () => {
  await render(1, 'event-1') // 初回ロード: 定員1
  await change('first-slot-capacity', '2')
  // 保存後の読み直しでは新しい定員を返す。
  st.listSlots.mockResolvedValueOnce({ items: [slotCap2] })
  await click('概要を保存して次へ')
  expect(st.updateSlot).toHaveBeenCalledTimes(1)
  // 更新の戻り値だけでなく一覧を再取得していること
  // （PUT 応答は active_count を持たないため）。
  expect(st.listSlots.mock.calls.length).toBeGreaterThanOrEqual(2)

  // ②の一覧・残席が新しい定員2を反映する（再読込なし）。
  await render(2, 'event-1')
  expect(host.textContent).toContain('2名')
})

it('EVENT-02: 公開OFFでは主ボタンが「下書きとして保存」になる', async () => {
  st.getEvent.mockResolvedValue({ ...ev, is_published: 0 })
  await render(3, 'event-1')
  expect(buttonLabels()).toContain('下書きとして保存')
  expect(buttonLabels()).not.toContain('保存して公開')
})

it('EVENT-02: 公開ONでは主ボタンが「保存して公開」になる', async () => {
  st.getEvent.mockResolvedValue({ ...ev, is_published: 1 })
  await render(3, 'event-1')
  expect(buttonLabels()).toContain('保存して公開')
  expect(buttonLabels()).not.toContain('下書きとして保存')
})

it('EVENT-03: 取消期限の null は作成画面でも「不可」と表示し、開始直前までの選択肢がある', async () => {
  // 保存値 null（旧作成画面では「いつでもキャンセルできる」と読めた）。
  st.getEvent.mockResolvedValue({ ...ev, cancel_deadline_hours_before: null })
  await render(2, 'event-1')
  const select = host.querySelector<HTMLSelectElement>('#cancel-deadline')!
  expect(select).toBeTruthy()
  expect(select.value).toBe('none')
  const labels = Array.from(select.options).map((o) => o.textContent ?? '')
  expect(labels[0]).toContain('不可')
  expect(labels).toContain('開始直前までキャンセルできる')
  // 「いつでもキャンセルできる」= 許可と読める旧ラベルは残さない。
  expect(labels.join('')).not.toContain('いつでも')
})

it('EVENT-03: 取消期限を往復させても保存値が変わらない', async () => {
  st.getEvent.mockResolvedValue({ ...ev, cancel_deadline_hours_before: 2 })
  await render(2, 'event-1')
  const select = host.querySelector<HTMLSelectElement>('#cancel-deadline')!
  expect(select.value).toBe('2')
  await change('cancel-deadline', '0')
  expect(select.value).toBe('0')
})

it('EVENT-04: 締切「開始の2時間前」が選択肢にあり、保存値をそのまま表示する', async () => {
  st.getEvent.mockResolvedValue({ ...ev, entry_cutoff_hours_before: 2 })
  await render(3, 'event-1')
  const select = host.querySelector<HTMLSelectElement>('#entry-cutoff')!
  expect(select.value).toBe('2')
  const labels = Array.from(select.options).map((o) => o.textContent ?? '')
  expect(labels).toContain('開始の2時間前まで')
  // 先頭項目（開始まで受け付ける）を選んだように見せない。
  expect(select.options[select.selectedIndex]?.textContent).toBe('開始の2時間前まで')
})

it('EVENT-04: 選択肢に無い保存値は「保存済み」として明示する', async () => {
  st.getEvent.mockResolvedValue({ ...ev, entry_cutoff_hours_before: 5 })
  await render(3, 'event-1')
  const select = host.querySelector<HTMLSelectElement>('#entry-cutoff')!
  expect(select.value).toBe('5')
  expect(select.options[select.selectedIndex]?.textContent).toBe('保存済み：開始の5時間前まで')
})
