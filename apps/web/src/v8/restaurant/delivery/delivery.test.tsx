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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

    // 行の右端は、主な操作を1つだけボタンにし、残り（断る）は「…」に入れる（B-360 C）。
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

    // 自作の `<select>` ではなく、共通部品の押しボタン＋選ぶ窓であること（B-172）。
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

/*
 * 承認v02（★承認済み デリバリー受注_v02.pen／2026-10-09 利用者承認）の見え方を守る。
 * ここは絵との「一致」を測る場ではない（happy-dom に寸法の計算は無いので、
 * 1行か2行か・窓の高さは測れない）。測るのは scripts/visual-qa/frame-parity.mjs の役目。
 * この組は、絵に合わせて決めた作り（並べ方の組・頭の印・札の種類・札の数）が
 * あとから静かに戻っていないかを見張る。
 */
describe('承認v02の見え方を守る', () => {
  const css = readFileSync(join(__dirname, 'delivery.module.css'), 'utf8')

  it('注文一覧（kDQHr）のサービス札は1行に3つ並べる', () => {
    // 絵（kDQHr）は札3つを横一列。縦積みにすると KPI も表もまるごと下へずれる。
    expect(css).toMatch(/\.serviceRow \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  })

  it('3枚の頭・中身の余白は共通の器の既定に任せ、数字で渡さない（説明は「？」の中）', () => {
    const page = readFileSync(join(__dirname, 'delivery.tsx'), 'utf8')
    expect(page).not.toMatch(/HEAD_PAD_TOP|HEAD_TEXT_GAP|VIEW_BODY/)
    expect(page).not.toMatch(/headPadTop=|headTextGap=|bodyPadTop=|bodyGap=/)
    expect(page).not.toMatch(/descriptionAs=/)
    // 題の大きさだけ、注文履歴と品切れは小さい題（絵 OzHLO・h7OeT）。
    expect(page).toMatch(/history: \{ titleSize: 'sub' \}/)
    expect(page).toMatch(/'sold-out': \{ titleSize: 'sub' \}/)
  })

  it('一覧の表・帯・箱は共通部品に任せ、画面専用の見た目を足さない', () => {
    const orders = readFileSync(join(__dirname, 'orders.tsx'), 'utf8')
    const history = readFileSync(join(__dirname, 'history.tsx'), 'utf8')
    const bulk = readFileSync(join(__dirname, 'bulk.tsx'), 'utf8')
    for (const source of [orders, history, bulk]) {
      expect(source).not.toMatch(/presentation="delivery"/)
      expect(source).not.toMatch(/delivery-(row|bulk|head)/)
      expect(source).not.toMatch(/さらに表示/)
    }
    expect(css).not.toMatch(/\.sumCard|\.selectBar|\.stopCard|\.stateBox|\.tabTableGroup/)
    expect(css).not.toMatch(/nth-child/)
    expect(orders).toMatch(/BulkBar/)
    expect(orders).toMatch(/Pagination/)
    expect(history).toMatch(/KpiBand/)
    expect(bulk).toMatch(/CheckCard/)
  })

  it('品切れ（h7OeT）の「品切れ」の札は赤（tone="danger"）', async () => {
    // 重ねた絵の色を測ったら、絵の「品切れ」は赤 #b3261e、画面は橙 #c2410c(warning) だった。
    // 赤の系統は共通の札の tone="danger"。画面CSSで色を塗らず、渡す種類を直す。
    at('/restaurant-test/delivery?view=sold-out')
    render(<DeliveryPage />)

    const soldOut = await screen.findByText('品切れ')
    expect(soldOut.closest('[data-tone]')?.getAttribute('data-tone')).toBe('danger')
    expect(screen.getByText('販売中').closest('[data-tone]')?.getAttribute('data-tone')).toBe('success')
  })

  it('共通部品の見た目を画面CSSから上書きしない', () => {
    // 設計ルール「部品の見た目を画面側で上書きしない（直すときは部品を直す）」。
    // 親の共通器へ :has で届く指定と、別の場所で出る共通の窓への指定を置かない。
    expect(css).not.toMatch(/\bdiv:has\(/)
    expect(css).not.toMatch(/\[data-design-part='dialog'\]/)
  })

  it('確認の窓の題の段は共通部品の任意の引数で絵に合わせる', () => {
    // 絵（dgeTy・XCVGd）は印と題が縦の中央・間12・題 18/700。画面CSSで上書きせず、
    // 共通の窓の titleRow="mark" を渡す。渡さない窓の既定（上そろえ・間8・600）は変えない。
    expect(readFileSync(join(__dirname, 'order-detail.tsx'), 'utf8')).toMatch(/titleRow="mark"/)
    expect(readFileSync(join(__dirname, 'bulk.tsx'), 'utf8')).toMatch(/titleRow="mark"/)
    const shared = readFileSync(join(__dirname, '../../../components/shared/dialog.module.css'), 'utf8')
    expect(shared).toMatch(/\[data-design-title-row='mark'\] \.titleRow \{[^}]*align-items: center;[^}]*gap: 12px;/)
    expect(shared).toMatch(/\[data-design-title-row='mark'\] \.title \{[^}]*font-weight: 700;/)
  })

  it('注文詳細（hjdqV）の頭は題＋受信・希望の1行で、窓の上端は絵の100', () => {
    /*
     * 窓の頭の高さと欄の間は数字で渡さず、共通の窓・欄の既定に任せる。
     * 補足の行は共通の窓の任意の引数 titleNote で出し、渡さない窓の並びは変えない。
     */
    const detail = readFileSync(join(__dirname, 'order-detail.tsx'), 'utf8')
    expect(detail).toMatch(/const DETAIL_TOP = 100/)
    expect(detail).toMatch(/titleNote=\{summaryLine\}/)
    expect(detail).not.toMatch(/headerHeight=\{|contentGap=\{/)
    // 絵の下のボタンの段に線は無い。
    expect(detail).toMatch(/footerPlain/)
    const shared = readFileSync(join(__dirname, '../../../components/shared/dialog.module.css'), 'utf8')
    expect(shared).toMatch(/:root \.titleNote \{[^}]*font-size: var\(--text-caption\)/)
  })

  it('注文詳細（hjdqV）の数量と金額は離れた2つの右寄せの列にする', () => {
    // 絵の右端は 884 と 976。隣り合わせに並べると金額が数量にくっつく。
    expect(css).toMatch(/\.itemQty \{[^}]*flex: 0 0 var\(--tpl-rt-dlv-item-qty\)/)
    expect(css).toMatch(/\.itemAmount \{[^}]*flex: 0 0 var\(--tpl-rt-dlv-item-amount\)/)
    expect(css).toMatch(/\.itemQty,\n\.itemAmount \{[^}]*text-align: right/)
    // 列の間に余白を入れると数量の右端が絵からずれる。
    expect(css).toMatch(/\.itemRow \{[^}]*gap: 0;/)
  })

  it('注文詳細（hjdqV）は品目と受け取り情報を1行ずつ線で区切る', () => {
    /*
     * 絵は品目の行（41／補足つき61）と受け取り情報の段（33）をどれも薄い線で区切り、
     * 合計の前だけ濃い線。最後の段には線を引かない。
     */
    expect(css).toMatch(/\.itemRow \{[^}]*padding-bottom: var\(--tpl-rt-dlv-item-pad\);[^}]*border-bottom: 1px solid var\(--color-divider\)/)
    expect(css).toMatch(/\.itemRow \+ \.itemRow \{\n  padding-top: var\(--tpl-rt-dlv-item-pad\);/)
    expect(css).toMatch(/\.itemList > \.itemRow:last-child \{\n  border-bottom-color: var\(--color-hairline\);/)
    expect(css).toMatch(/\.factKey,\n\.factValue \{[^}]*border-bottom: 1px solid var\(--color-divider\)/)
    expect(css).toMatch(/\.detailFacts > :nth-last-child\(-n \+ 2\) \{[^}]*border-bottom: 0;/)
    // 合計の上の線は最後の品目の行が持つので、合計自身は線を引かない。
    expect(css).not.toMatch(/\.total \{[^}]*border-top/)
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
