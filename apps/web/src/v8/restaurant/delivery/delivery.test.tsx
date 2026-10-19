// @vitest-environment happy-dom
/*
 * デリバリー受注の見え方（★承認済み デリバリー受注_v02.pen／2026-10-09 利用者承認）。
 * 守るのは BEHAVIOR.md に書いた決めごと：
 *  - 板の印は `?view=` で入れ替わる（注文一覧 kDQHr・注文履歴・売上 OzHLO・品切れ一括設定 h7OeT）。
 *  - 注文番号を押すと `?id=` が付いて注文の詳細（hjdqV）が開く。移動は useSamePageUrl を通す。
 *  - 「まとめて受け付ける」は新着だけを相手にし、まとめ送りの口が無いので1件ずつ順に送る。
 *  - 急ぎ度は結果と理由の文だけを出し、判定の仕組みの名前（Clef）は画面に出さない。
 *  - 閲覧のみ（staff）には送るボタンを置かない。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RestaurantStore } from '@/lib/restaurant-test-api'
import type {
  DeliveryMenuItem,
  DeliveryOrderSummary,
  DeliveryOrdersData,
  DeliveryService,
  DeliveryServiceState,
} from '@/lib/restaurant-delivery-api'

const fixture = vi.hoisted(() => ({
  orders: vi.fn(),
  order: vi.fn(),
  accept: vi.fn(),
  ready: vi.fn(),
  reject: vi.fn(),
  cancel: vi.fn(),
  history: vi.fn(),
  historyCsv: vi.fn(),
  menuItems: vi.fn(),
  bulkSoldOut: vi.fn(),
  stopIntake: vi.fn(),
  resumeIntake: vi.fn(),
  snapshot: vi.fn(),
  role: { value: 'owner' as string | null },
}))

vi.mock('@/lib/restaurant-delivery-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/restaurant-delivery-api')>()
  return {
    ...actual,
    restaurantDeliveryApi: {
      orders: fixture.orders,
      order: fixture.order,
      accept: fixture.accept,
      ready: fixture.ready,
      reject: fixture.reject,
      cancel: fixture.cancel,
      history: fixture.history,
      historyCsv: fixture.historyCsv,
      menuItems: fixture.menuItems,
      bulkSoldOut: fixture.bulkSoldOut,
      stopIntake: fixture.stopIntake,
      resumeIntake: fixture.resumeIntake,
    },
  }
})

vi.mock('@/lib/restaurant-test-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/restaurant-test-api')>()
  return { ...actual, restaurantTestApi: { snapshot: fixture.snapshot } }
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-1',
    setSelectedAccountId: vi.fn(),
    accounts: [],
    loading: false,
  }),
}))

vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => fixture.role.value,
  canManageRole: (role: string | null) => role === 'owner' || role === 'admin',
}))

/*
 * 絞り込みは URL から読む。移動は `useSamePageUrl` がルーターを通さず
 * `window.history` を直に書く（読み直しが起きないようにするため）。本物の Next は
 * その書き換えを拾って `useSearchParams` を新しくするので、試験でも同じように
 * 履歴の書き換えを見張って読み直す形にする。
 */
vi.mock('next/navigation', async () => {
  const react = await import('react')
  const listeners = new Set<() => void>()
  for (const key of ['pushState', 'replaceState'] as const) {
    const original = window.history[key].bind(window.history)
    window.history[key] = ((...args: Parameters<History['pushState']>) => {
      original(...args)
      for (const listener of [...listeners]) listener()
    }) as History['pushState']
  }
  return {
    useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
    usePathname: () => '/restaurant-test/delivery',
    useSearchParams: () => {
      const search = react.useSyncExternalStore(
        (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify) } },
        () => window.location.search,
        () => '',
      )
      return new URLSearchParams(search)
    },
  }
})

import DeliveryPage from './delivery'

function serviceState(
  service: DeliveryService,
  label: string,
  patch: Partial<DeliveryServiceState> = {},
): DeliveryServiceState {
  return {
    service,
    label,
    connectionStatus: 'connected',
    intakeStatus: 'open',
    stopUntil: null,
    todayCount: 4,
    todayAmount: 12000,
    ...patch,
  }
}

function order(
  id: string,
  orderNumber: string,
  patch: Partial<DeliveryOrderSummary> = {},
): DeliveryOrderSummary {
  return {
    id,
    service: 'ubereats',
    serviceLabel: 'Uber Eats',
    orderNumber,
    status: 'new',
    statusLabel: '新着',
    totalAmount: 3480,
    itemCount: 2,
    itemSummary: '唐揚げ弁当×1・味噌汁×1',
    urgency: 'urgent',
    urgencyReason: '受け取り希望まで10分を切っています',
    receivedAt: '2026-10-09T03:02:00.000Z',
    wantedAt: '2026-10-09T03:15:00.000Z',
    ...patch,
  }
}

function ordersData(orders: DeliveryOrderSummary[]): DeliveryOrdersData {
  return {
    success: true,
    store: { id: 'store-1', name: '然-NEN- 本店' },
    services: [
      serviceState('ubereats', 'Uber Eats'),
      serviceState('demaecan', '出前館'),
      serviceState('rocketnow', 'ロケットナウ', {
        intakeStatus: 'stopped',
        stopUntil: '2026-10-09T04:00:00.000Z',
      }),
    ],
    kpis: {
      todayCount: 12,
      todayCountDelta: 2,
      handedOverCount: 8,
      todaySales: 41_200,
      todaySalesDeltaPercent: 12,
      averageAmount: 3433,
      urgentCount: 1,
      averagePrepMinutes: 14,
      averagePrepMinutesDelta: -1,
    },
    tab: 'new',
    tabCounts: { all: 12, new: orders.length, cooking: 2, handed_over: 8 },
    orders,
  }
}

function store(): RestaurantStore {
  return {
    id: 'store-1',
    organization_id: 'org-1',
    name: '然-NEN- 本店',
    code: 'NEN01',
    area: null,
    capacity: 20,
    timezone: 'Asia/Tokyo',
    status: 'active',
    line_status: 'connected',
    google_status: 'connected',
    line_account_id: 'account-1',
    line_account_name: '然-NEN-',
  }
}

function menuItem(id: string, name: string, soldOut = false): DeliveryMenuItem {
  return {
    id,
    name,
    category: '弁当',
    price: 980,
    soldOut,
    soldOutAt: soldOut ? '2026-10-09T03:00:00.000Z' : null,
    services: [{ service: 'ubereats', label: 'Uber Eats' }],
  }
}

function at(url: string) {
  window.history.replaceState(null, '', url)
}

beforeEach(() => {
  fixture.role.value = 'owner'
  fixture.snapshot.mockResolvedValue({ success: true, data: { stores: [store()] } })
  fixture.orders.mockResolvedValue(ordersData([
    order('o1', 'UE-1001'),
    order('o2', 'DM-2002', {
      service: 'demaecan',
      serviceLabel: '出前館',
      status: 'cooking',
      statusLabel: '調理中',
      urgency: 'normal',
      urgencyReason: '余裕があります',
    }),
  ]))
  fixture.accept.mockResolvedValue({
    success: true,
    order: { id: 'o1', status: 'cooking', statusLabel: '調理中', updatedAt: null },
  })
  fixture.order.mockResolvedValue({
    success: true,
    order: {
      id: 'o1',
      service: 'ubereats',
      serviceLabel: 'Uber Eats',
      orderNumber: 'UE-1001',
      status: 'new',
      statusLabel: '新着',
      totalAmount: 3480,
      currency: 'JPY',
      itemCount: 2,
      urgency: 'urgent',
      urgencyReason: '受け取り希望まで10分を切っています',
      pickupMethod: '配達員が受け取り',
      wantedAt: '2026-10-09T03:15:00.000Z',
      customerNote: null,
      cancelReasonCode: null,
      canceledBy: null,
      receivedAt: '2026-10-09T03:02:00.000Z',
      acceptedAt: null,
      readyAt: null,
      handedOverAt: null,
      canceledAt: null,
    },
    items: [{ name: '唐揚げ弁当', note: null, quantity: 1, amount: 980 }],
  })
  fixture.history.mockResolvedValue({
    success: true,
    range: { from: '2026-10-09', to: '2026-10-09' },
    filter: { service: null, status: null },
    totals: { count: 12, amount: 41_200, canceledCount: 1, byService: [] },
    orders: [],
  })
  fixture.menuItems.mockResolvedValue({
    success: true,
    store: { id: 'store-1', name: '然-NEN- 本店' },
    items: [menuItem('m1', '唐揚げ弁当'), menuItem('m2', '味噌汁', true)],
  })
  at('/restaurant-test/delivery?tab=new')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  at('/')
})

describe('kDQHr デリバリー受注', () => {
  it('注文一覧の板・サービス3枚・新着の操作を出す', async () => {
    render(<DeliveryPage />)

    expect(await screen.findByText('#UE-1001')).toBeTruthy()
    expect(document.querySelector('[data-design-node="kDQHr"]')).toBeTruthy()

    // 相手は Uber Eats・出前館・ロケットナウの3つだけ（menu も Camel も出さない）。
    expect(screen.getAllByText('Uber Eats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('出前館').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ロケットナウ').length).toBeGreaterThan(0)

    // 行の右端は、主な操作を1つだけボタンにし、残り（断る）は「…」に入れる（ C）。
    // 新着は「受け付ける」、調理中は「準備完了にする」。
    expect(screen.getByLabelText('注文UE-1001を受け付ける')).toBeTruthy()
    expect(screen.queryByLabelText('注文UE-1001を拒否')).toBeNull()
    expect(screen.getByLabelText('注文DM-2002を準備完了にする')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '注文UE-1001のその他の操作' }))
    expect(await screen.findByRole('menuitem', { name: '断る' })).toBeTruthy()

    // 停止中のサービスには再開を置く。
    expect(screen.getByLabelText('ロケットナウの受付を再開')).toBeTruthy()
  })

  it('急ぎ度は札だけを出し、理由は添え書きに回して仕組みの名前は出さない', async () => {
    render(<DeliveryPage />)
    await screen.findByText('#UE-1001')

    expect(screen.getAllByText('急ぎ').length).toBeGreaterThan(0)
    // 絵（kDQHr）の一覧は札だけ。理由の文は幅を押し広げるので添え書きにする。
    expect(screen.queryByText('受け取り希望まで10分を切っています')).toBeNull()
    expect(document.querySelector('[title="受け取り希望まで10分を切っています"]')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Clef/i)
  })

  it('まとめて受け付けるは新着だけを1件ずつ順に送る', async () => {
    render(<DeliveryPage />)
    await screen.findByText('#UE-1001')

    // 調理中は選べない（新着だけが相手）。
    const cooking = screen.getByLabelText('注文DM-2002を選ぶ') as HTMLInputElement
    expect(cooking.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('新着の注文をすべて選ぶ'))
    expect(screen.getByText('1件を選択中')).toBeTruthy()

    fireEvent.click(screen.getByText('まとめて受け付ける'))
    await waitFor(() => expect(fixture.accept).toHaveBeenCalledTimes(1))
    expect(fixture.accept).toHaveBeenCalledWith('account-1', 'o1')
  })

  it('注文番号を押すと ?id= が付いて注文の詳細が開く', async () => {
    render(<DeliveryPage />)
    await screen.findByText('#UE-1001')

    fireEvent.click(screen.getByLabelText('注文UE-1001の詳細'))

    await waitFor(() => expect(window.location.search).toContain('id=o1'))
    expect(await screen.findByText('注文の詳細')).toBeTruthy()
    expect(document.querySelector('[data-design-node="hjdqV"]')).toBeTruthy()
    expect(fixture.order).toHaveBeenCalledWith('account-1', 'o1')

    // 急ぎ度の理由の文は注文の詳細（hjdqV）の帯で出す。仕組みの名前は出さない。
    expect(await screen.findByText('急ぎ対応のおすすめ')).toBeTruthy()
    expect(screen.getByText('受け取り希望まで10分を切っています')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Clef/i)
  })

  it('店舗を選ぶ欄は共通の選ぶ部品（押すと選ぶ窓が開く）にする', async () => {
    render(<DeliveryPage />)
    await screen.findByText('#UE-1001')

    // 自作の `<select>` ではなく、共通部品の押しボタン＋選ぶ窓であること。
    const picker = screen.getByRole('button', { name: '店舗' })
    fireEvent.click(picker)
    expect(await screen.findByRole('dialog', { name: '店舗を選ぶ' })).toBeTruthy()
  })
})

describe('?view= で板を入れ替える', () => {
  it('history は注文履歴・売上（OzHLO）を出す', async () => {
    at('/restaurant-test/delivery?view=history')
    render(<DeliveryPage />)

    await waitFor(() => expect(fixture.history).toHaveBeenCalled())
    expect(document.querySelector('[data-design-node="OzHLO"]')).toBeTruthy()
    expect(screen.getByText('注文履歴・売上')).toBeTruthy()
  })

  it('sold-out は品切れ一括設定（h7OeT）を出す', async () => {
    at('/restaurant-test/delivery?view=sold-out')
    render(<DeliveryPage />)

    expect(await screen.findByText('唐揚げ弁当')).toBeTruthy()
    expect(document.querySelector('[data-design-node="h7OeT"]')).toBeTruthy()
    expect(screen.getByText('品切れ一括設定')).toBeTruthy()
  })
})

describe('閲覧のみ（staff）', () => {
  it('受け付ける・拒否・準備完了・停止・再開を置かない', async () => {
    fixture.role.value = 'staff'
    render(<DeliveryPage />)
    await screen.findByText('#UE-1001')

    expect(screen.queryByLabelText('注文UE-1001を受け付ける')).toBeNull()
    expect(screen.queryByLabelText('注文UE-1001を拒否')).toBeNull()
    expect(screen.queryByLabelText('注文DM-2002を準備完了にする')).toBeNull()
    expect(screen.queryByLabelText('ロケットナウの受付を再開')).toBeNull()
    expect(screen.queryByLabelText('Uber Eatsの受付を止める')).toBeNull()
    expect(screen.queryByText('受付をまとめて止める')).toBeNull()
    // 閲覧のみの帯を出す。
    expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()

    // 見るだけの操作は残す。
    expect(screen.getByLabelText('注文UE-1001の詳細')).toBeTruthy()
  })
})

/* 見た目は実ブラウザで測る。この組は一覧と確認の操作を守る。 */
describe('一覧と確認の操作を保つ', () => {

  it('品切れ（h7OeT）の「品切れ」の札は赤（tone="danger"）', async () => {
    // 重ねた絵の色を測ったら、絵の「品切れ」は赤 #b3261e、画面は橙 #c2410c(warning) だった。
    // 赤の系統は共通の札の tone="danger"。画面CSSで色を塗らず、渡す種類を直す。
    at('/restaurant-test/delivery?view=sold-out')
    render(<DeliveryPage />)

    const soldOut = await screen.findByText('品切れ')
    expect(soldOut.closest('[data-tone]')?.getAttribute('data-tone')).toBe('danger')
    expect(screen.getByText('販売中').closest('[data-tone]')?.getAttribute('data-tone')).toBe('success')
  })

  it('注文履歴（OzHLO）は売上の4つの数を線で区切った1本の帯（KpiBand）で出す', async () => {
    at('/restaurant-test/delivery?view=history')
    render(<DeliveryPage />)
    await waitFor(() => expect(fixture.history).toHaveBeenCalled())

    // 絞り込みは共通の道具の段（ListToolbarRow）。日付は月日の書き方で切れない。
    expect(await screen.findByLabelText('日付')).toBeTruthy()

    const band = await waitFor(() => {
      const el = document.querySelector('[data-shared-part="kpi-band"][data-design="ZuE0v"]')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    expect(within(band).getByText('¥41,200')).toBeTruthy()
    expect(within(band).getByText('12件')).toBeTruthy()
    // 合計＋サービス3つの4マス。
    expect(band.querySelectorAll('[data-kpi-label]').length).toBe(4)
  })

  it('キャンセルの確認（dgeTy）は白地の頭＋注意三角で、危険用の帯を出さない', async () => {
    render(<DeliveryPage />)
    await screen.findByText('#UE-1001')
    fireEvent.click(screen.getByLabelText('注文UE-1001の詳細'))

    const detail = (await waitFor(() => {
      const el = document.querySelector('[data-design-node="hjdqV"]')
      expect(el).toBeTruthy()
      return el
    })) as HTMLElement
    fireEvent.click(within(detail).getByRole('button', { name: '注文をキャンセルする' }))

    const dialog = (await waitFor(() => {
      const el = document.querySelector('[data-design-node="dgeTy"]')
      expect(el).toBeTruthy()
      return el
    })) as HTMLElement

    // 共通の窓は危険な操作のとき頭を帯で囲むが、絵は白地。plainTitle で帯を外している。
    expect(dialog.querySelector('[data-qa-dialog-callout]')).toBeNull()
    // 題の左に丸い注意三角を置く。
    const heading = dialog.querySelector('h2')
    const mark = heading?.previousElementSibling
    expect(mark?.tagName).toBe('SPAN')
    expect(mark?.querySelector('svg')).toBeTruthy()
  })

  it('受付の一括停止（XCVGd）は共通のチェックの札（CheckCard）と、別々の時間札4つを置く', async () => {
    render(<DeliveryPage />)
    await screen.findByText('#UE-1001')
    fireEvent.click(screen.getByText('受付をまとめて止める'))

    const dialog = (await waitFor(() => {
      const el = document.querySelector('[data-design-node="XCVGd"]')
      expect(el).toBeTruthy()
      return el
    })) as HTMLElement

    expect(dialog.querySelector('[data-qa-dialog-callout]')).toBeNull()

    // サービスごとに共通のチェックの札を置き、中に丸い札を入れる。
    for (const label of ['Uber Eats', '出前館', 'ロケットナウ']) {
      const box = within(dialog).getByRole('checkbox', { name: new RegExp(`${label}の受付を止める`) })
      expect(box.closest('label')).toBeTruthy()
      expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0)
    }

    // 時間は共通の切り替え部品に任せ、つながった帯ではなく離れた札4つにする。
    const times = within(dialog).getByRole('group', { name: '停止する時間' })
    expect(times.getAttribute('data-appearance')).toBe('intake-stop')
    // つまみ（滑る白い帯）は出さない。
    expect(times.querySelector('[aria-hidden="true"]')).toBeNull()
    const cards = times.querySelectorAll('button')
    expect(cards.length).toBe(4)
    expect(Array.from(cards).map((card) => card.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ])
  })
})


describe('注文履歴のページ送り', () => {
  it('次のページと表示件数を変えても重複や抜けなく注文を読める', async () => {
    fixture.history.mockResolvedValue({
      success: true,
      range: { from: '2026-10-09', to: '2026-10-09' },
      filter: { service: null, status: null },
      totals: { count: 25, amount: 87000, canceledCount: 0, byService: [] },
      orders: Array.from({ length: 25 }, (_, index) => order(`page-${index}`, `PAGE-${index + 1}`)),
    })
    at('/restaurant-test/delivery?view=history')
    render(<DeliveryPage />)
    const table = await screen.findByRole('table', { name: 'デリバリーの注文履歴' })
    await within(table).findByText('#PAGE-20')
    expect(within(table).queryByText('#PAGE-21')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    expect(await within(table).findByText('#PAGE-21')).toBeTruthy()
    expect(within(table).getByText('#PAGE-25')).toBeTruthy()
    expect(within(table).queryByText('#PAGE-20')).toBeNull()
    expect(screen.getByRole('button', { name: '次のページ' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '表示件数' }))
    fireEvent.click(screen.getByRole('option', { name: '10件表示' }).querySelector('button')!)
    expect(await within(table).findByText('#PAGE-1')).toBeTruthy()
    expect(within(table).getByText('#PAGE-10')).toBeTruthy()
    expect(within(table).queryByText('#PAGE-11')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    expect(await within(table).findByText('#PAGE-11')).toBeTruthy()
    expect(within(table).getByText('#PAGE-20')).toBeTruthy()
    expect(within(table).queryByText('#PAGE-10')).toBeNull()
  })
})
