// @vitest-environment happy-dom
/*
 * L (#824 数字の出どころ)・M (今後の予定)のカード描画試験。
 *
 * - 今後の予定: 7日分の3種類を時刻順に並べ、種類ごとの一覧へつなぐ。
 *   旧Workerでは予約だけの表示へ戻る。
 * - 今日の配信の失敗: 台帳の件数と一致する数と、出どころ・時点の「?」。
 *   空・読込中・失敗・正常の4状態を押さえる。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    <a href={href} {...(rest as object)}>{children as never}</a>,
}))

const apiMocks = vi.hoisted(() => ({
  upcoming: vi.fn(),
  deliveryFailureOrigins: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    dashboard: {
      upcoming: apiMocks.upcoming,
      deliveryFailureOrigins: apiMocks.deliveryFailureOrigins,
    },
  },
}))

import { DeliveryFailuresCard, UpcomingCard } from './side-cards'

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

function mount(node: React.ReactNode): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(node)
  })
  return container
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

const upcomingData = {
  items: [
    { kind: 'reminder', id: 'fr-1', title: '来店前日（あおい）', startsAt: '2026-09-28T01:00:00.000Z', href: '/reminders' },
    { kind: 'broadcast', id: 'bc-1', title: '秋の案内', startsAt: '2026-09-29T01:00:00.000Z', href: '/broadcasts' },
    { kind: 'booking', id: 'bk-1', title: '相談30分（あおい）', startsAt: '2026-09-30T01:00:00.000Z', href: '/booking/bookings?view=list' },
  ],
  asOf: '2026-09-27T00:00:00.000Z',
  rangeDays: 7,
}

const originsData = {
  total: 3,
  asOf: '2026-09-27T11:50:00+09:00',
  origins: [
    { source: 'broadcast.failed', failures: 2, latestFailedAt: '2026-09-27T11:50:00+09:00', sampleDeliveryIds: ['delivery-a'] },
  ],
}

describe('UpcomingCard（今後の予定）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('3種類を時刻順に並べ、種類ごとの一覧へつなぐ', async () => {
    apiMocks.upcoming.mockResolvedValue({ success: true, data: upcomingData })
    const el = mount(<UpcomingCard accountId="acc-1" bookings={null} loading={false} />)
    await flush()
    expect(el.textContent).toContain('今後の予定')
    const links = [...el.querySelectorAll('a')] as HTMLAnchorElement[]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/reminders', '/broadcasts', '/booking/bookings?view=list'])
    expect(el.textContent).toContain('配信')
    expect(el.textContent).toContain('リマインダー')
    expect(el.textContent).toContain('予約')
  })

  it('空のときは予定なしと出す', async () => {
    apiMocks.upcoming.mockResolvedValue({ success: true, data: { ...upcomingData, items: [] } })
    const el = mount(<UpcomingCard accountId="acc-1" bookings={null} loading={false} />)
    await flush()
    expect(el.textContent).toContain('予定されている配信・予約はありません')
  })

  it('旧Workerでは予約だけの表示へ戻る', async () => {
    apiMocks.upcoming.mockRejectedValue(new Error('not found'))
    const bookings = [
      { id: 'bk-9', menu_name: '相談', friend_name: 'あおい', starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), status: 'confirmed' },
    ]
    const el = mount(<UpcomingCard accountId="acc-1" bookings={bookings as never} loading={false} />)
    await flush()
    expect(el.textContent).toContain('相談')
    expect(el.textContent).toContain('すべて見る')
  })

  it('両方取れなければ失敗と出す', async () => {
    apiMocks.upcoming.mockRejectedValue(new Error('down'))
    const el = mount(<UpcomingCard accountId="acc-1" bookings={null} loading={false} />)
    await flush()
    expect(el.textContent).toContain('予定を読み込めませんでした')
  })
})

describe('DeliveryFailuresCard（今日の配信の失敗）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('台帳の件数を出し、「?」に出どころと時点を出す', async () => {
    apiMocks.deliveryFailureOrigins.mockResolvedValue({ success: true, data: originsData })
    const el = mount(<DeliveryFailuresCard accountId="acc-1" />)
    await flush()
    expect(el.textContent).toContain('今日の配信の失敗')
    expect(el.textContent).toContain('3件')
    const help = el.querySelector('button[aria-label="今日の配信の失敗の説明"]')
    expect(help).not.toBeNull()
    act(() => {
      help?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(el.textContent).toContain('出どころ：通知の送達台帳')
    expect(el.textContent).toContain('同じ失敗は1件として数えています（送り直しは数えません）')
  })

  it('0件は0件と出す（「—」にしない）', async () => {
    apiMocks.deliveryFailureOrigins.mockResolvedValue({ success: true, data: { total: 0, asOf: null, origins: [] } })
    const el = mount(<DeliveryFailuresCard accountId="acc-1" />)
    await flush()
    expect(el.textContent).toContain('0件')
    expect(el.textContent).not.toContain('—')
  })

  it('失敗は「—」と読み込めなかった旨を出す', async () => {
    apiMocks.deliveryFailureOrigins.mockRejectedValue(new Error('down'))
    const el = mount(<DeliveryFailuresCard accountId="acc-1" />)
    await flush()
    expect(el.textContent).toContain('—')
    expect(el.textContent).toContain('読み込めませんでした')
  })

  it('読込中は骨組みを出す', () => {
    apiMocks.deliveryFailureOrigins.mockReturnValue(new Promise(() => {}))
    const el = mount(<DeliveryFailuresCard accountId="acc-1" />)
    expect(el.querySelector('.animate-pulse')).not.toBeNull()
    expect(el.textContent).not.toContain('読み込めませんでした')
  })
})
