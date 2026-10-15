// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeliverySettingsPage, { SERVICES, type DeliveryService } from './delivery'

/**
 * 設定 › デリバリー連携（`dF4Ov` ／ `OIY4Z` ／ `kJLks` ／ `X5d8UF`、2026-10-12 利用者承認）の退行試験。
 *
 * Uber Eats は受け口がつながったので押せる。出前館・ロケットナウは返事待ちで押せないまま。
 * 接続後の段（`OIY4Z`）と2つの窓（`kJLks` ／ `X5d8UF`）は各社の返事が来てから動く経路なので、
 * ここでは入口の値を差し替えて、そのときに出る表示と状態の変わり方を固定する。
 *
 * サーバの読み取りは「お店（LINEアカウント）が選ばれている」ときだけ通る。
 * 入口の値を差し替える試験は `accountId` を null にして、読み取りが上書きしない状態にしてある。
 */

const fixture = vi.hoisted(() => ({
  role: { value: 'owner' as string | null },
  /** 画面の住所に付く `?ubereats=…`。Uber から戻ったときの符号を入れる。 */
  search: { value: '' },
  accountId: { value: null as string | null },
  connection: vi.fn(),
  connectStart: vi.fn(),
}))

vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => fixture.role.value,
  canManageRole: (role: string | null) => role === 'owner' || role === 'admin',
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
  useHideSettingsNav: () => {},
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(fixture.search.value),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId.value, accounts: [] }),
}))
vi.mock('@/lib/restaurant-delivery-api', () => ({
  restaurantDeliveryApi: {
    ubereatsConnection: fixture.connection,
    ubereatsConnectStart: fixture.connectStart,
  },
}))

/** サーバが返す接続の状態のひな型。 */
function connection(next: Partial<{ status: string; storeName: string | null; connectedAt: string | null; checkedAt: string | null }> = {}, oauthConfigured = true) {
  return {
    success: true,
    store: { id: 'store-1', name: '本店' },
    oauthConfigured,
    connection: {
      status: 'disconnected',
      storeName: null,
      connectedAt: null,
      provisionedAt: null,
      checkedAt: null,
      lastError: null,
      ...next,
    },
  }
}

const REAL_LOCATION = window.location

/** 移動先だけを見るために画面の住所を差し替える（試験の中では実際に移動しない）。 */
function stubLocation(): { href: string } {
  const fake = { href: '' }
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: fake })
  return fake
}

function card(name: string) {
  return within(screen.getByRole('region', { name }))
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

/** 返事が来た会社の形。`ready` を true にすると各社のつなぎ方が動く。 */
function uber(next: Partial<DeliveryService> = {}): DeliveryService {
  const base = SERVICES.find((service) => service.id === 'uber')
  if (!base) throw new Error('Uber Eats の段が見つかりません')
  return { ...base, ready: true, ...next }
}

const STORES = [
  { id: 'store-1', name: '渋谷店', address: '東京都渋谷区道玄坂1-2-3' },
  { id: 'store-2', name: '新宿店', address: '東京都新宿区西新宿4-5-6' },
]

afterEach(() => {
  cleanup()
  fixture.role.value = 'owner'
  fixture.search.value = ''
  fixture.accountId.value = null
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: REAL_LOCATION })
  vi.resetAllMocks()
})

describe('設定 › デリバリー連携', () => {
  it('DL-1：3社が承認どおりの順で出て、Uber Eats だけ押せる', () => {
    render(<DeliverySettingsPage />)

    // 画面の題も h2 なので、箱の題だけを取り出して並びを見る。
    const titles = screen
      .getAllByRole('region')
      .map((region) => region.querySelector('h2')?.textContent)
    expect(titles).toEqual(['Uber Eats', '出前館', 'ロケットナウ'])
    expect(screen.getAllByText('未接続')).toHaveLength(3)

    const login = button('Uber Eats にログインしてつなぐ')
    expect(login.disabled).toBe(false)
    expect(login.title).toBe('')
    // 返事待ちの2社は押せないまま、待ちの案内を添える。
    const apply = screen.getAllByRole('button', { name: '連携を申し込む' }) as HTMLButtonElement[]
    expect(apply).toHaveLength(2)
    expect(apply.every((one) => one.disabled)).toBe(true)
    expect(apply.every((one) => one.title.includes('musubo が各デリバリーサービスへ連携のお手続きを進めています'))).toBe(true)
  })

  it('つなぐを押すと、サーバが返した Uber のログイン画面へ移る', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection())
    fixture.connectStart.mockResolvedValue({ success: true, mode: 'connect', authorizeUrl: 'https://auth.uber.com/oauth/v2/authorize?x=1' })
    const location = stubLocation()

    render(<DeliverySettingsPage />)
    await waitFor(() => expect(fixture.connection).toHaveBeenCalledWith('acc-1'))

    fireEvent.click(button('Uber Eats にログインしてつなぐ'))
    await waitFor(() => expect(fixture.connectStart).toHaveBeenCalledWith('acc-1'))
    expect(location.href).toBe('https://auth.uber.com/oauth/v2/authorize?x=1')
  })

  it('この環境に接続の設定が無ければ、つなぐボタンを押させない', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({}, false))

    render(<DeliverySettingsPage />)
    await waitFor(() => expect(button('Uber Eats にログインしてつなぐ').disabled).toBe(true))
    expect(fixture.connectStart).not.toHaveBeenCalled()
  })

  it('Uber から戻った直後（お店は未選択）は未接続のまま、続きを帯で伝える', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=pending_store'
    fixture.connection.mockResolvedValue(connection({ status: 'pending_store' }))

    render(<DeliverySettingsPage />)

    const note = await screen.findByText(/Uber Eats へのログインは受け取りました/)
    const uberCard = card('Uber Eats')
    expect(uberCard.getByText('未接続')).toBeTruthy()
    // 新しい状態札は増やさず、承認案 `OIY4Z` の帯で伝える。
    expect(note.closest('[data-design-part="notice"]')).toBeTruthy()
  })

  it('Uber から戻った符号が失敗なら、理由を危険の帯で出す', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=error:denied'
    fixture.connection.mockResolvedValue(connection())

    render(<DeliverySettingsPage />)

    const note = await screen.findByText(/「許可」が押されなかったため/)
    const notice = note.closest('[data-design-part="notice"]')
    expect(notice?.getAttribute('role')).toBe('alert')
    // 符号そのものは画面に出さない。
    expect(screen.queryByText(/error:denied/)).toBeNull()
  })

  it('サーバの状態が接続中なら、つないだお店をサーバの値で出す', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(
      connection({ status: 'connected', storeName: '渋谷店', connectedAt: '2026-10-13T02:30:00.000Z', checkedAt: '2026-10-13T03:00:00.000Z' })
    )

    render(<DeliverySettingsPage />)

    expect(await screen.findByText('渋谷店')).toBeTruthy()
    const uberCard = card('Uber Eats')
    expect(uberCard.getByText('接続中')).toBeTruthy()
    expect(uberCard.getByText('つないだお店')).toBeTruthy()
  })

  it('閲覧のみの担当にはボタンを出さない', () => {
    fixture.role.value = 'staff'
    render(<DeliverySettingsPage />)

    expect(screen.queryByRole('button', { name: 'Uber Eats にログインしてつなぐ' })).toBeNull()
    expect(screen.queryByRole('button', { name: '連携を申し込む' })).toBeNull()
  })

  it('DL-2：接続中はつないだお店・つないだ日・最後に確かめた時刻が出る', () => {
    render(
      <DeliverySettingsPage
        services={[uber({
          status: 'connected',
          storeName: '渋谷店',
          connectedAt: '2026-10-10T02:30:00.000Z',
          checkedAt: '2026-10-12T01:00:00.000Z',
        })]}
      />
    )

    const uberCard = card('Uber Eats')
    expect(uberCard.getByText('接続中')).toBeTruthy()
    expect(uberCard.getByText('つないだお店')).toBeTruthy()
    expect(uberCard.getByText('渋谷店')).toBeTruthy()
    expect(uberCard.getByText('つないだ日')).toBeTruthy()
    expect(uberCard.getByText('最後に確かめた時刻')).toBeTruthy()
    expect(uberCard.getByRole('button', { name: '接続を確かめる' })).toBeTruthy()
    expect(uberCard.getByRole('button', { name: '連携を解除する' })).toBeTruthy()
  })

  it('DL-2：接続エラーは理由の囲みを危険の色で出す', () => {
    render(
      <DeliverySettingsPage
        services={[uber({ status: 'error', storeName: '渋谷店', stateNote: '注文を受け取れませんでした。musubo が確認しています。' })]}
      />
    )

    const uberCard = card('Uber Eats')
    expect(uberCard.getByText('接続エラー')).toBeTruthy()
    // 状態の注記は共通の帯（Notice）で出す。危険の帯は role="alert" で、
    // 色は共通の `.danger` が持つ（自作の data-tone は持たない／B-172 status-badge）。
    const notice = uberCard.getByText('注文を受け取れませんでした。musubo が確認しています。').closest('[data-design-part="notice"]')
    expect(notice).toBeTruthy()
    expect(notice?.getAttribute('role')).toBe('alert')
  })

  it('DL-2：申し込み受付中は申し込んだ日と取り消しの口を出す', () => {
    render(
      <DeliverySettingsPage
        services={[{ ...uber(), id: 'demaecan', name: '出前館', connect: 'apply', status: 'applying', appliedAt: '2026-10-11T04:00:00.000Z' }]}
      />
    )

    const demaecan = card('出前館')
    expect(demaecan.getByText('申し込み受付中')).toBeTruthy()
    expect(demaecan.getByText('申し込んだ日')).toBeTruthy()

    fireEvent.click(demaecan.getByRole('button', { name: '申し込みを取り消す' }))
    expect(card('出前館').getByText('未接続')).toBeTruthy()
  })

  it('申し込む会社は押すと申し込み受付中になる', () => {
    render(<DeliverySettingsPage services={[{ ...uber(), id: 'demaecan', name: '出前館', connect: 'apply' }]} />)

    fireEvent.click(button('連携を申し込む'))
    const demaecan = card('出前館')
    expect(demaecan.getByText('申し込み受付中')).toBeTruthy()
    expect(demaecan.getByText('申し込んだ日')).toBeTruthy()
  })

  it('DL-3：連携を解除する窓から外すと未接続に戻る', () => {
    render(<DeliverySettingsPage services={[uber({ status: 'connected', storeName: '渋谷店' })]} />)

    fireEvent.click(button('連携を解除する'))
    expect(screen.getByText('Uber Eatsの連携を解除しますか')).toBeTruthy()

    fireEvent.click(button('解除する'))
    expect(screen.queryByText('Uber Eatsの連携を解除しますか')).toBeNull()
    const uberCard = card('Uber Eats')
    expect(uberCard.getByText('未接続')).toBeTruthy()
    expect(uberCard.queryByText('渋谷店')).toBeNull()
  })

  it('DL-4：お店を選ぶまでつなげず、選ぶと接続中になる', () => {
    render(<DeliverySettingsPage services={[uber({ stores: STORES })]} />)

    fireEvent.click(button('Uber Eats にログインしてつなぐ'))
    expect(screen.getByText('つなぐお店を選んでください')).toBeTruthy()
    expect(button('このお店につなぐ').disabled).toBe(true)

    // 共通の RadioCardGroup は fieldset ＋ legend で描くので、役割は group。
    const stores = within(screen.getByRole('group', { name: 'つなぐお店' }))
    expect(stores.getByText('新宿店')).toBeTruthy()
    fireEvent.click(stores.getByText('渋谷店'))
    expect(button('このお店につなぐ').disabled).toBe(false)

    fireEvent.click(button('このお店につなぐ'))
    expect(screen.queryByText('つなぐお店を選んでください')).toBeNull()
    const uberCard = card('Uber Eats')
    expect(uberCard.getByText('接続中')).toBeTruthy()
    expect(uberCard.getByText('渋谷店')).toBeTruthy()
  })
})
