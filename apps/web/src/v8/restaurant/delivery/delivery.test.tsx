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

    // 新着は「受け付ける」「拒否」、調理中は「準備完了」。
    expect(screen.getByLabelText('注文UE-1001を受け付ける')).toBeTruthy()
    expect(screen.getByLabelText('注文UE-1001を拒否')).toBeTruthy()
    expect(screen.getByLabelText('注文DM-2002を準備完了にする')).toBeTruthy()

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
    expect(screen.getByText('選択中 1件')).toBeTruthy()

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
    expect(screen.queryByLabelText('Uber Eatsの受付を停止')).toBeNull()
    expect(screen.queryByText('受付を一括停止')).toBeNull()

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

  it('3枚の中身の余白は器の任意の引数で渡す（絵 kDQHr 14/12・OzHLO 4・h7OeT 0）', () => {
    // 共通の器 CHz31 は上16・段の間16。絵は板ごとに違うので、画面CSSから器を
    // 上書きせず、RestaurantPage の bodyPadTop/bodyGap で板ごとに渡す。
    const page = readFileSync(join(__dirname, 'delivery.tsx'), 'utf8')
    expect(page).toMatch(/orders: \{ padTop: 14, gap: 12 \}/)
    expect(page).toMatch(/history: \{ padTop: 4 \}/)
    expect(page).toMatch(/'sold-out': \{ padTop: 0 \}/)
    expect(page).toMatch(/bodyPadTop=\{VIEW_BODY\[view\]\.padTop\}/)
    expect(page).toMatch(/bodyGap=\{VIEW_BODY\[view\]\.gap\}/)
  })

  it('3枚の板の頭も器の任意の引数で渡す（絵 上20・間4・説明は題の下）', () => {
    // 絵は説明を題のすぐ下に 1 行で描き、「?」は描かない。共通の器の既定（上24・間8・
    // 説明は HelpTip の中）は変えず、RestaurantPage の任意の引数で板ごとに渡す。
    // 題は絵のとおり kDQHr 22/700/32・注文履歴と品切れ 18/700/27（正本の順位は 絵 > 決まりの板）。
    const page = readFileSync(join(__dirname, 'delivery.tsx'), 'utf8')
    expect(page).toMatch(/const HEAD_PAD_TOP = 20/)
    expect(page).toMatch(/const HEAD_TEXT_GAP = 4/)
    expect(page).toMatch(/orders: \{ descriptionSize: 'body' \}/)
    expect(page).toMatch(/history: \{ titleSize: 'sub' \}/)
    expect(page).toMatch(/'sold-out': \{ titleSize: 'sub' \}/)
    expect(page).toMatch(/descriptionAs="text"/)
    expect(page).toMatch(/headPadTop=\{HEAD_PAD_TOP\}/)
    expect(page).toMatch(/headTextGap=\{HEAD_TEXT_GAP\}/)
  })

  it('注文一覧（kDQHr）の表はタブと同じ塊に入れて間0にする', () => {
    // 絵は表がタブの段にくっついている。負の margin で引き戻すのではなく、
    // タブ・選んだ数の帯・表を自分の塊（間0）にまとめる。
    expect(css).toMatch(/\.tabTableGroup \{[^}]*gap: 0;/)
    const orders = readFileSync(join(__dirname, 'orders.tsx'), 'utf8')
    expect(orders).toMatch(/<div className=\{styles\.tabTableGroup\}>/)
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
     * 絵は窓が y100 から始まり、題の段が 77（上20＋題27＋間4＋補足18＋下8）。
     * 補足の行は共通の窓の任意の引数 titleNote で出し、渡さない窓の並びは変えない。
     */
    const detail = readFileSync(join(__dirname, 'order-detail.tsx'), 'utf8')
    expect(detail).toMatch(/const DETAIL_TOP = 100/)
    expect(detail).toMatch(/const DETAIL_HEAD_H = 77/)
    expect(detail).toMatch(/titleNote=\{summaryLine\}/)
    expect(detail).toMatch(/headerHeight=\{DETAIL_HEAD_H\}/)
    // 絵の下のボタンの段に線は無い。
    expect(detail).toMatch(/footerPlain/)
    const shared = readFileSync(join(__dirname, '../../../components/shared/dialog.module.css'), 'utf8')
    expect(shared).toMatch(/\[data-theme='v8'\] \.titleNote \{[^}]*font-size: var\(--text-caption\)/)
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

  it('注文履歴（OzHLO）の絞り込みは折り返さない', () => {
    // 折り返すと板の頭が2段に伸びて、下の集計・表がまるごとずれる。
    expect(css).toMatch(/\.filterRowOneLine \{[^}]*flex-wrap: nowrap/)
  })

  it('注文履歴（OzHLO）は大きく出す値を売上金額にし、件数は頭の右に小さく置く', async () => {
    at('/restaurant-test/delivery?view=history')
    render(<DeliveryPage />)
    await waitFor(() => expect(fixture.history).toHaveBeenCalled())

    // 絞り込みは1行の組を足した側に出す。
    const date = await screen.findByLabelText('日付')
    expect(date.closest('[class*="filterRowOneLine"]')).toBeTruthy()

    // 大きい値（.sumAmount は p）は金額。件数（.sumCount は span）はその前＝頭の中。
    const amount = await screen.findByText('¥41,200')
    expect(amount.tagName).toBe('P')
    const count = screen.getByText('12件')
    expect(count.tagName).toBe('SPAN')
    expect(count.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    fireEvent.click(within(detail).getByRole('button', { name: 'キャンセル' }))

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

  it('受付の一括停止（XCVGd）は枠付きのサービス札と、別々の時間札4つを置く', async () => {
    render(<DeliveryPage />)
    await screen.findByText('#UE-1001')
    fireEvent.click(screen.getByText('受付を一括停止'))

    const dialog = (await waitFor(() => {
      const el = document.querySelector('[data-design-node="XCVGd"]')
      expect(el).toBeTruthy()
      return el
    })) as HTMLElement

    expect(dialog.querySelector('[data-qa-dialog-callout]')).toBeNull()

    // 枠付きの札（.stopCard）をサービスごとに置き、中に選ぶ印と丸い札を入れる。
    for (const label of ['Uber Eats', '出前館', 'ロケットナウ']) {
      const box = within(dialog).getByLabelText(`${label}の受付を停止する`)
      expect(box.closest('[class*="stopCard"]')).toBeTruthy()
      expect(within(dialog).getByText(label)).toBeTruthy()
    }
    expect(css).toMatch(/\.stopCard \{[^}]*outline: 1px solid var\(--color-choice-border\)/)

    // 時間はつながった帯ではなく、離れた札4つ（押した札だけ色が付く）。
    const times = within(dialog).getByRole('group', { name: '停止する時間' })
    const cards = times.querySelectorAll('button')
    expect(cards.length).toBe(4)
    for (const card of Array.from(cards)) {
      expect(card.getAttribute('aria-pressed')).toBeTruthy()
      expect(card.className).toMatch(/timeCard/)
    }
  })
})
