// @vitest-environment happy-dom
/*
 * 予約枠の日時・定員をあとから直す試験（入口29 / #1061）。
 *
 * いまは予約枠を直すには「消して作り直す」しかなく、予約が入っている枠は
 * 消せないので日時も定員も直せなかった。見る筋書き:
 *   1. 枠の行の「編集」で、保存済みの日時・定員が入った窓が開く（JST表記）。
 *   2. 直して保存すると、既存の更新口（updateSlot）へ JST→UTC に戻して送る。
 *   3. 予約が入っている枠は、定員を予約数より下げられない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventItem, EventSlot } from '@/lib/api'

const eventsGet = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const updateSlot = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: { list: async () => ({ success: true, data: [] }) },
    },
    eventsApi: {
      ...actual.eventsApi,
      getEvent: eventsGet,
      listSlots,
      updateSlot,
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'acc-1', name: 'テスト店' }],
    selectedAccount: { id: 'acc-1', name: 'テスト店' },
    selectedAccountId: 'acc-1',
    loading: false,
  }),
}))

// api.ts は読み込み時に NEXT_PUBLIC_API_URL を要求する。画面の
// import より先に立てておく（Vite はファイル順に評価する）。
process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'

import EventForm from './event-form'

const event: EventItem = {
  id: 'ev-1',
  line_account_id: 'acc-1',
  name: '体験レッスン',
  description: '',
  is_published: 1,
  capacity: null,
  start_at: null,
  end_at: null,
  target_type: 'single',
  account_ids: null,
}

// JST 2026-10-01 14:00〜15:30、定員8、予約3件入りの枠。
const bookedSlot: EventSlot = {
  id: 'slot-1',
  event_id: 'ev-1',
  starts_at: '2026-10-01T05:00:00.000Z',
  ends_at: '2026-10-01T06:30:00.000Z',
  capacity: 8,
  is_active: 1,
  sort_order: 0,
  active_count: 3,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  eventsGet.mockReset()
  listSlots.mockReset()
  updateSlot.mockReset()
  eventsGet.mockResolvedValue(event)
  listSlots.mockResolvedValue({ items: [bookedSlot] })
  updateSlot.mockResolvedValue({ item: { ...bookedSlot, capacity: 10 } })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function renderForm() {
  await act(async () => { root.render(<EventForm accountId="acc-1" eventId="ev-1" />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === text && !b.disabled)
}

/** タブは見出し＋補足が1つのボタンに入っているので先頭一致で探す。 */
function tabButton(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith(label) && !b.disabled)
}

async function click(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function dialog(): HTMLElement | null {
  return host.querySelector('.fixed.inset-0')
}

function dialogInput(kind: string, index = 0): HTMLInputElement {
  const inputs = [...(dialog()?.querySelectorAll(`input[type="${kind}"]`) ?? [])] as HTMLInputElement[]
  expect(inputs[index], `${kind} 入力の ${index} 番目がある`).toBeTruthy()
  return inputs[index]
}

/** 窓の中の「保存」。ページ側の「保存して次へ」と取り違えないよう窓の中だけ探す。 */
function dialogSaveButton(): HTMLButtonElement {
  const found = [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === '保存')
  expect(found, '窓の「保存」がある').toBeTruthy()
  return found!
}

describe('予約枠の編集（入口29）', () => {
  async function openEdit() {
    await renderForm()
    await click(tabButton('2. 予約枠')!)
    await click(button('編集')!)
    expect(host.textContent).toContain('予約枠を編集')
  }

  it('「編集」で保存済みの日時・定員が入った窓が開く', async () => {
    await openEdit()
    expect(dialogInput('date').value).toBe('2026-10-01')
    expect(dialogInput('time', 0).value).toBe('14:00')
    expect(dialogInput('time', 1).value).toBe('15:30')
    expect(dialogInput('number').value).toBe('8')
    // 予約が入っているので、動かすとリマインドも動くことを先に伝える。
    expect(host.textContent).toContain('3件の予約')
  })

  it('定員を直して保存すると、既存の更新口へ送る', async () => {
    await openEdit()
    await act(async () => { setInput(dialogInput('number'), '10') })
    await click(dialogSaveButton())
    expect(updateSlot).toHaveBeenCalledTimes(1)
    expect(updateSlot).toHaveBeenCalledWith('acc-1', 'ev-1', 'slot-1', {
      starts_at: '2026-10-01T05:00:00.000Z',
      ends_at: '2026-10-01T06:30:00.000Z',
      capacity: 10,
    })
    // 窓が閉じて、一覧を取り直している。
    expect(listSlots).toHaveBeenCalledTimes(2)
  })

  it('開始時刻を動かすと JST→UTC に戻して送る', async () => {
    await openEdit()
    await act(async () => { setInput(dialogInput('time', 0), '13:00') })
    await click(dialogSaveButton())
    expect(updateSlot).toHaveBeenCalledWith('acc-1', 'ev-1', 'slot-1', {
      starts_at: '2026-10-01T04:00:00.000Z',
      ends_at: '2026-10-01T06:30:00.000Z',
      capacity: 8,
    })
  })

  it('予約数より小さい定員には下げられない', async () => {
    await openEdit()
    await act(async () => { setInput(dialogInput('number'), '2') })
    await click(dialogSaveButton())
    expect(updateSlot).not.toHaveBeenCalled()
    expect(host.textContent).toContain('定員は3以上にしてください')
  })

  it('開始が終了以降のままでは保存できない', async () => {
    await openEdit()
    await act(async () => { setInput(dialogInput('time', 0), '16:00') })
    await click(dialogSaveButton())
    expect(updateSlot).not.toHaveBeenCalled()
    expect(host.textContent).toContain('開始時刻 < 終了時刻')
  })
})
