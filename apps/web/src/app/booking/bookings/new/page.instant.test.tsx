// @vitest-environment happy-dom
/*
 * 代理予約画面を本物の React で mount し、非JST店舗（America/New_York）の
 * 予約で「どの瞬間を送るか」だけを見る（#651）。
 *
 * 文字合わせの契約試験では、画面が壁時刻を組み立て直していても気づけない。
 * ここは本物の React（react-dom/client）・本物の効果・本物のクリックで、
 * `createProxyBooking` に渡った `starts_at` を見る。
 *
 * 見張る崩れ方:
 *   1. NY の 10:00 を JST 固定のずれで読み、前日 21:00 の instant を送る。
 *   2. 入力画面で見えた古い候補の instant を、読み直した後も送り続ける。
 *   3. 開始 instant を受け取れていないのに確定させる。
 *
 * 差し替えるのは通信（bookingApi）と、選択の部品（Select）・遷移
 * （next/link）だけ。画面の判断は差し替えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listMenus: vi.fn(),
  listMenuStaff: vi.fn(),
  getAvailability: vi.fn(),
  getCustomerContext: vi.fn(),
  previewReminders: vi.fn(),
  createProxyBooking: vi.fn(),
  getAlternatives: vi.fn(),
  createCustomer: vi.fn(),
}))

const friendsList = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    bookingApi: api,
    api: { ...actual.api, friends: { ...actual.api.friends, list: friendsList } },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-ny', accounts: [{ id: 'account-ny', name: 'NY店' }] }),
}))

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは選んだ後の画面の判断なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label': string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

import NewProxyBookingPage from './page'

const NY = 'America/New_York'

/** NY 2026-11-02（EST）10:00 の instant。 */
const NY_1000 = '2026-11-02T10:00:00-05:00'
/** 同じ壁時刻を JST 固定のずれで読んだ instant（送ってはいけない値）。 */
const FAKE_JST_1000 = '2026-11-02T01:00:00.000Z'

function slot(startUtc: string, start = '10:00', end = '11:00') {
  return {
    date: '2026-11-02',
    start,
    end,
    timeZone: NY,
    startUtc,
    endUtc: new Date(new Date(startUtc).getTime() + 3600_000).toISOString(),
    capacity: 1,
    remaining: 1,
    state: 'available' as const,
  }
}

function availability(slots: Array<ReturnType<typeof slot>>) {
  return { by_staff: [{ staff_id: 'staff-ny', display_name: '担当NY', slots }] }
}

// React に「試験の中で動かしている」と伝える。無いと act の警告が出る。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(NewProxyBookingPage)) })
}

function all(tag: string): HTMLElement[] {
  return Array.from(container.querySelectorAll(tag)) as HTMLElement[]
}

function byText(tag: string, text: string): HTMLElement {
  const found = all(tag).find((element) => element.textContent?.includes(text))
  if (!found) throw new Error(`見つかりません: <${tag}> "${text}"`)
  return found
}

function byLabel(label: string): HTMLElement {
  const found = all('input,select').find((element) => element.getAttribute('aria-label') === label)
  if (!found) throw new Error(`見つかりません: aria-label="${label}"`)
  return found
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

async function setValue(element: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

/** 効果と、画面の 250ms の待ちが片付くまで進める。 */
async function settle(ms = 300) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

/** 友だち・メニュー・担当・日付・時刻を選んで、確認へ進む手前まで進める。 */
async function fillInput() {
  const search = all('input').find((element) => element.getAttribute('placeholder') === '名前・電話番号で探す')!
  await setValue(search, '予約者')
  await settle()
  await click(byText('button', '予約者NY'))
  await setValue(byLabel('予約メニュー'), 'menu-ny')
  await act(async () => { await Promise.resolve() })
  await setValue(byLabel('担当者'), 'staff-ny')
  await act(async () => { await Promise.resolve() })
  const dateInput = all('input').find((element) => element.getAttribute('type') === 'date')!
  await setValue(dateInput, '2026-11-02')
  await act(async () => { await Promise.resolve() })
  await setValue(byLabel('空いている時間'), '10:00')
}

describe('代理予約: 店舗タイムゾーンの instant で確定する（実React・NY店舗）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listMenus.mockResolvedValue({
      menus: [{
        id: 'menu-ny', name: '相談', category_label: null, description: null,
        duration_minutes: 60, buffer_after_minutes: 0, base_price: 8000,
        sort_order: 0, is_active: 1, auto_tag_id: null,
      }],
    })
    api.listMenuStaff.mockResolvedValue({
      staff: [{
        id: 'staff-ny', display_name: '担当NY', role: null, profile_image_url: null,
        bio: null, is_designation_optional: 0, price: 8000, duration_minutes: 60,
      }],
    })
    api.getCustomerContext.mockResolvedValue({ customer: null })
    api.previewReminders.mockResolvedValue({ reminders: [] })
    api.createProxyBooking.mockResolvedValue({
      booking_id: 'booking-1', status: 'confirmed', calendar_sync: 'not_configured',
      line_notification: 'queued', reminders: [], operations: [], customer_context: null,
    })
    friendsList.mockResolvedValue({
      success: true,
      data: { items: [{ id: 'friend-ny', displayName: '予約者NY', pictureUrl: null }] },
    })
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
  })

  it('NY 10:00 の候補は、店舗の instant のまま送る（JST 固定のずれで読み直さない）', async () => {
    api.getAvailability.mockResolvedValue(availability([slot(NY_1000)]))
    await mount()
    await fillInput()

    await click(byText('button', '予約内容を確認する'))
    expect(api.previewReminders).toHaveBeenCalledWith('account-ny', '2026-11-02T15:00:00.000Z')

    await click(byText('button', 'この内容で予約を入れる'))
    expect(api.createProxyBooking).toHaveBeenCalledTimes(1)
    expect(api.createProxyBooking.mock.calls[0][1]).toMatchObject({
      starts_at: '2026-11-02T15:00:00.000Z',
    })
    expect(api.createProxyBooking.mock.calls[0][1].starts_at).not.toBe(FAKE_JST_1000)
  })

  it('確認直前に読み直した候補の instant を送る（入力時の古い instant は捨てる）', async () => {
    // 入力中に店舗の設定が直り、同じ壁時刻 10:00 の instant が 1 時間ずれた。
    const stale = '2026-11-02T10:00:00-04:00'
    // 入力画面の一覧は古い instant。確認直前の読み直しから正しい instant になる。
    api.getAvailability.mockResolvedValue(availability([slot(stale)]))
    await mount()
    await fillInput()
    api.getAvailability.mockResolvedValue(availability([slot(NY_1000)]))

    await click(byText('button', '予約内容を確認する'))
    await click(byText('button', 'この内容で予約を入れる'))

    expect(api.createProxyBooking.mock.calls[0][1]).toMatchObject({
      starts_at: '2026-11-02T15:00:00.000Z',
    })
    expect(api.createProxyBooking.mock.calls[0][1].starts_at)
      .not.toBe(new Date(stale).toISOString())
  })

  it('読み直した候補に開始 instant が無ければ確認へ進まず、予約も送らない', async () => {
    api.getAvailability.mockResolvedValue(availability([slot(NY_1000)]))
    await mount()
    await fillInput()
    // 読み直しで開始 instant が欠けた候補が返る。
    api.getAvailability.mockResolvedValue(availability([{ ...slot(NY_1000), startUtc: '' }]))

    await click(byText('button', '予約内容を確認する'))

    expect(container.textContent).toContain('この時間の開始時刻を受け取れませんでした。時間を選び直してください。')
    expect(api.previewReminders).not.toHaveBeenCalled()
    expect(api.createProxyBooking).not.toHaveBeenCalled()
    // 確認画面へは進んでいない。
    expect(all('button').some((b) => b.textContent?.includes('この内容で予約を入れる'))).toBe(false)
  })

  it('読み直しで枠が消えていたら、競合画面へ移り予約は送らない', async () => {
    api.getAvailability.mockResolvedValue(availability([slot(NY_1000)]))
    api.getAlternatives.mockResolvedValue({
      conflict: { from: NY_1000, to: NY_1000, count: 1, source: 'internal_booking' },
      nearbySlots: [], alternateStaff: [],
    })
    await mount()
    await fillInput()
    // 読み直したら枠が消えていた。
    api.getAvailability.mockResolvedValue(availability([]))

    await click(byText('button', '予約内容を確認する'))

    expect(api.getAlternatives).toHaveBeenCalledWith('account-ny', {
      menuId: 'menu-ny', staffId: 'staff-ny', startsAt: '2026-11-02T15:00:00.000Z',
    })
    expect(api.createProxyBooking).not.toHaveBeenCalled()
    expect(container.textContent).toContain('選んだ時間は、ほかの予約で埋まりました')
  })
})
