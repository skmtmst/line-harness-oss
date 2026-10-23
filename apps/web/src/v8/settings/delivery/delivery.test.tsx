// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
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
  checkConnection: vi.fn(),
  disconnect: vi.fn(),
  connectStart: vi.fn(),
  stores: vi.fn(),
  selectStore: vi.fn(),
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
vi.mock('@/lib/restaurant-delivery-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/restaurant-delivery-api')>('@/lib/restaurant-delivery-api')
  return {
    ...actual,
    restaurantDeliveryApi: {
      ...actual.restaurantDeliveryApi,
      ubereatsConnection: fixture.connection,
      ubereatsCheckConnection: fixture.checkConnection,
      ubereatsDisconnect: fixture.disconnect,
      ubereatsConnectStart: fixture.connectStart,
      ubereatsStores: fixture.stores,
      ubereatsSelectStore: fixture.selectStore,
    },
  }
})

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

function connectionMutation(next: Partial<ReturnType<typeof connection>['connection']> = {}) {
  return { success: true, connection: { ...connection().connection, ...next } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
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
    expect(card('Uber Eats').getByText('Uber Eats への接続を設定します。注文の連携は受注画面で確認します')).toBeTruthy()

    const login = button('Uber Eats にログインしてつなぐ')
    expect(login.disabled).toBe(false)
    expect(login.title).toBe('')
    // 未接続の会社は準備中の案内を開き、申込済みと偽らない。
    const apply = screen.getAllByRole('button', { name: '連携を申し込む' }) as HTMLButtonElement[]
    expect(apply).toHaveLength(2)
    expect(apply.every((one) => !one.disabled)).toBe(true)
    expect(screen.queryByRole('button', { name: '保存する' })).toBeNull()
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
    expect(uberCard.getByText('受注画面で確認', { exact: true })).toBeTruthy()
    expect(uberCard.queryByRole('button', { name: /注文の連携/ })).toBeNull()
    expect(uberCard.getByText('つないだお店')).toBeTruthy()
  })

  it('閲覧のみの担当にはボタンを出さない', () => {
    fixture.role.value = 'staff'
    render(<DeliverySettingsPage />)

    expect(screen.queryByRole('button', { name: 'Uber Eats にログインしてつなぐ' })).toBeNull()
    expect(screen.queryByRole('button', { name: '連携を申し込む' })).toBeNull()
    expect(screen.getByText(/閲覧のみ/)).toBeTruthy()
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
    // 色は共通の `.danger` が持つ（自作の data-tone は持たない／ status-badge）。
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
    expect(screen.getByText('現在準備中です')).toBeTruthy()
    expect(card('出前館').getByText('申し込み受付中')).toBeTruthy()
  })

  it('未接続の会社への申し込みは準備中を示し、接続や日付を作らない', () => {
    render(<DeliverySettingsPage services={[{ ...uber(), id: 'demaecan', name: '出前館', connect: 'apply' }]} />)
    fireEvent.click(button('連携を申し込む'))
    expect(screen.getByText('現在準備中です')).toBeTruthy()
    expect(card('出前館').getByText('未接続')).toBeTruthy()
    expect(card('出前館').queryByText('申し込んだ日')).toBeNull()
  })

  it('DL-3：確認窓で確定した1回だけ解除し、サーバの解除済み応答を反映する', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'connected', storeName: '渋谷店' }))
    const pending = deferred<ReturnType<typeof connectionMutation>>()
    fixture.disconnect.mockReturnValue(pending.promise)

    render(<DeliverySettingsPage />)
    expect(await screen.findByText('渋谷店')).toBeTruthy()

    fireEvent.click(button('連携を解除する'))
    // 承認案 `kJLks` のとおり、英字で終わる社名のあとは半角の空きを入れる。
    expect(screen.getByText('Uber Eats の連携を解除しますか')).toBeTruthy()
    expect(screen.getByText(/^Uber Eats とのつなぎを外します。/)).toBeTruthy()
    expect(fixture.disconnect).not.toHaveBeenCalled()

    fireEvent.click(button('解除する'))
    expect(fixture.disconnect).toHaveBeenCalledWith('acc-1')
    expect(fixture.disconnect).toHaveBeenCalledTimes(1)
    expect(button('解除しています…').disabled).toBe(true)
    fireEvent.click(button('解除しています…'))
    expect(fixture.disconnect).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve(connectionMutation({ status: 'disconnected' })))
    await waitFor(() => expect(screen.queryByText('Uber Eats の連携を解除しますか')).toBeNull())
    expect(card('Uber Eats').getByText('未接続')).toBeTruthy()
    expect(card('Uber Eats').queryByText('渋谷店')).toBeNull()
    expect(screen.queryByText('現在準備中です')).toBeNull()
  })

  it('DL-3：解除結果が確定しなければ窓と接続表示を保ち、自動で送り直さない', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'connected', storeName: '渋谷店' }))
    fixture.disconnect.mockResolvedValue(connectionMutation({ status: 'connected', storeName: '渋谷店' }))

    render(<DeliverySettingsPage />)
    expect(await screen.findByText('渋谷店')).toBeTruthy()
    fireEvent.click(button('連携を解除する'))
    fireEvent.click(button('解除する'))

    expect(await screen.findByText(/解除結果を確認できませんでした/)).toBeTruthy()
    expect(screen.getByText('Uber Eats の連携を解除しますか')).toBeTruthy()
    expect(button('解除する').disabled).toBe(true)
    expect(card('Uber Eats').getByText('接続エラー')).toBeTruthy()
    expect(card('Uber Eats').getByText('渋谷店')).toBeTruthy()
    expect((card('Uber Eats').getByRole('button', { name: '接続を確かめる' }) as HTMLButtonElement).disabled).toBe(true)
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fixture.disconnect).toHaveBeenCalledTimes(1)
  })

  it('DL-3：解除結果不明の符号を受けたら接続操作を止める', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'connected', storeName: '渋谷店' }))
    fixture.disconnect.mockRejectedValue(new ApiError(503, 'API error: 503', 'pos_deactivation_unknown'))

    render(<DeliverySettingsPage />)
    expect(await screen.findByText('渋谷店')).toBeTruthy()
    fireEvent.click(button('連携を解除する'))
    fireEvent.click(button('解除する'))

    expect(await screen.findByText(/解除結果を確認できませんでした/)).toBeTruthy()
    expect(button('解除する').disabled).toBe(true)
    expect(card('Uber Eats').getByText('接続エラー')).toBeTruthy()
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fixture.disconnect).toHaveBeenCalledTimes(1)
  })

  it('DL-3：再認証が必要なら接続表示を保ち、ログインし直す必要を伝える', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'connected', storeName: '渋谷店' }))
    fixture.disconnect.mockRejectedValue(new ApiError(409, 'API error: 409', 'reauthorization_required'))
    fixture.connectStart.mockResolvedValue({ success: true, mode: 'reconnect', authorizeUrl: 'https://auth.uber.com/oauth/v2/authorize?reauth=1' })
    const location = stubLocation()

    render(<DeliverySettingsPage />)
    expect(await screen.findByText('渋谷店')).toBeTruthy()
    fireEvent.click(button('連携を解除する'))
    fireEvent.click(button('解除する'))

    expect(await screen.findAllByText(/Uber Eats へログインし直す必要があります/)).toHaveLength(2)
    expect(screen.getByText('Uber Eats の連携を解除しますか')).toBeTruthy()
    expect(button('解除する').disabled).toBe(true)
    expect(card('Uber Eats').getByText('接続中')).toBeTruthy()
    expect(card('Uber Eats').getByText('渋谷店')).toBeTruthy()
    expect(fixture.disconnect).toHaveBeenCalledTimes(1)
    expect(fixture.connectStart).not.toHaveBeenCalled()

    fireEvent.click(button('キャンセル'))
    expect(card('Uber Eats').getByText('Uber Eats へログインし直す必要があります。「Uber Eats にログインし直す」から、もう一度許可してください。')).toBeTruthy()
    fireEvent.click(button('Uber Eats にログインし直す'))
    await waitFor(() => expect(fixture.connectStart).toHaveBeenCalledWith('acc-1'))
    expect(location.href).toBe('https://auth.uber.com/oauth/v2/authorize?reauth=1')
  })

  it('期限切れの接続は再ログインの入口を出し、reconnect応答だけで認可画面へ移る', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'expired', storeName: '渋谷店' }))
    fixture.connectStart.mockResolvedValue({ success: true, mode: 'reconnect', authorizeUrl: 'https://auth.uber.com/oauth/v2/authorize?reauth=1' })
    const location = stubLocation()

    render(<DeliverySettingsPage />)
    expect(await screen.findByText(/Uber Eats へのログインの期限が切れました/)).toBeTruthy()
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button('Uber Eats にログインし直す'))

    await waitFor(() => expect(fixture.connectStart).toHaveBeenCalledWith('acc-1'))
    expect(location.href).toBe('https://auth.uber.com/oauth/v2/authorize?reauth=1')
  })

  it('再ログイン開始がreconnectでなければ認可画面へ移らない', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'expired', storeName: '渋谷店' }))
    fixture.connectStart.mockResolvedValue({ success: true, mode: 'connect', authorizeUrl: 'https://auth.uber.com/oauth/v2/authorize?wrong=1' })
    const location = stubLocation()

    render(<DeliverySettingsPage />)
    expect(await screen.findByText(/Uber Eats へのログインの期限が切れました/)).toBeTruthy()
    fireEvent.click(button('Uber Eats にログインし直す'))

    expect(await screen.findByText(/ログイン画面を開けませんでした/)).toBeTruthy()
    expect(location.href).toBe('')
    expect(fixture.connectStart).toHaveBeenCalledTimes(1)
  })

  it('DL-4：Uber から戻ると候補を取って窓が開き、選ぶと接続中になる', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=pending_store'
    fixture.connection.mockResolvedValue(connection({ status: 'pending_store' }))
    fixture.stores.mockResolvedValue({ success: true, stores: STORES })
    fixture.selectStore.mockResolvedValue({
      success: true,
      connection: {
        status: 'connected',
        storeName: '渋谷店',
        connectedAt: '2026-10-17T02:30:00.000Z',
        provisionedAt: '2026-10-17T02:30:00.000Z',
        checkedAt: '2026-10-17T02:30:00.000Z',
        lastError: null,
      },
    })

    render(<DeliverySettingsPage />)

    // 戻った直後だけ Uber へ問い合わせ、続きの選び口を自動で開く。
    expect(await screen.findByText('つなぐお店を選んでください')).toBeTruthy()
    // 承認案 `X5d8UF` の本文のとおり。社名のあとの半角の空きまで含めて合わせる。
    expect(
      screen.getByText(
        'Uber Eats での許可をいただきました。Uber Eats に登録されているお店が2件見つかりました。musubo につなぐお店を選んでください。',
      ),
    ).toBeTruthy()
    expect(fixture.stores).toHaveBeenCalledWith('acc-1')
    expect(button('このお店につなぐ').disabled).toBe(true)
    expect(screen.getByText(/接続後、受注画面で利用できる注文の操作を確認してください/)).toBeTruthy()

    // 共通の RadioCardGroup は fieldset ＋ legend で描くので、役割は group。
    const stores = within(screen.getByRole('group', { name: 'つなぐお店' }))
    expect(stores.getByText('新宿店')).toBeTruthy()
    fireEvent.click(stores.getByText('渋谷店'))
    expect(button('このお店につなぐ').disabled).toBe(false)

    fireEvent.click(button('このお店につなぐ'))
    // 送るのは選ばれたお店のIDだけ。つないだお店の名もサーバが返した値で出す。
    await waitFor(() => expect(fixture.selectStore).toHaveBeenCalledWith('acc-1', 'store-1'))
    await waitFor(() => expect(screen.queryByText('つなぐお店を選んでください')).toBeNull())
    const uberCard = card('Uber Eats')
    expect(uberCard.getByText('接続中')).toBeTruthy()
    expect(uberCard.getByText('渋谷店')).toBeTruthy()
    expect(uberCard.getByText('受注画面で確認', { exact: true })).toBeTruthy()
    expect(uberCard.queryByRole('button', { name: /注文の連携/ })).toBeNull()
    expect(screen.queryByText(/Uber Eats へのログインは受け取りました/)).toBeNull()
  })

  it('DL-4：画面を開くだけでは Uber へ問い合わせず、続きはボタンから選べる', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'pending_store' }))
    fixture.stores.mockResolvedValue({ success: true, stores: STORES })

    render(<DeliverySettingsPage />)
    await waitFor(() => expect(fixture.connection).toHaveBeenCalledWith('acc-1'))
    expect(fixture.stores).not.toHaveBeenCalled()

    // ログインは済んでいるので、押してもログインのやり直しにはならない。
    fireEvent.click(button('Uber Eats にログインしてつなぐ'))
    await waitFor(() => expect(fixture.stores).toHaveBeenCalledWith('acc-1'))
    expect(await screen.findByText('つなぐお店を選んでください')).toBeTruthy()
    expect(fixture.connectStart).not.toHaveBeenCalled()
  })

  it('DL-4：つなげるお店が無ければ窓を開かず、ログインし直す案内を出す', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=pending_store'
    fixture.connection.mockResolvedValue(connection({ status: 'pending_store' }))
    fixture.stores.mockResolvedValue({ success: true, stores: [] })

    render(<DeliverySettingsPage />)

    expect(await screen.findByText(/お店が見つかりませんでした/)).toBeTruthy()
    expect(screen.queryByText('つなぐお店を選んでください')).toBeNull()
    expect(card('Uber Eats').getByText('未接続')).toBeTruthy()
  })

  it('DL-4：つなぐ確定が失敗したら窓を閉じて理由を出し、勝手に送り直さない', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=pending_store'
    fixture.connection.mockResolvedValue(connection({ status: 'pending_store' }))
    fixture.stores.mockResolvedValue({ success: true, stores: STORES })
    fixture.selectStore.mockRejectedValue(new Error('失敗'))

    render(<DeliverySettingsPage />)
    expect(await screen.findByText('つなぐお店を選んでください')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('group', { name: 'つなぐお店' })).getByText('渋谷店'))
    fireEvent.click(button('このお店につなぐ'))

    expect(await screen.findByText(/お店をつなげませんでした/)).toBeTruthy()
    expect(screen.queryByText('つなぐお店を選んでください')).toBeNull()
    // 結果が分からないまま重ねて送ると連携が重なるため、1回だけ送る。
    expect(fixture.selectStore).toHaveBeenCalledTimes(1)
    expect(card('Uber Eats').getByText('未接続')).toBeTruthy()
  })
  it('接続の確認はサーバが確定した状態と確認時刻だけを反映する', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({
      status: 'connected',
      storeName: '渋谷店',
      checkedAt: '2026-10-12T01:00:00.000Z',
    }))
    fixture.checkConnection.mockResolvedValue(connectionMutation({
      status: 'connected',
      storeName: '渋谷店',
      checkedAt: '2026-10-23T02:30:00.000Z',
    }))

    render(<DeliverySettingsPage />)
    expect(await screen.findByText('渋谷店')).toBeTruthy()
    const before = card('Uber Eats').getByText('最後に確かめた時刻').nextElementSibling?.textContent
    fireEvent.click(button('接続を確かめる'))
    expect(fixture.checkConnection).toHaveBeenCalledWith('acc-1')
    await waitFor(() => expect(card('Uber Eats').getByText('最後に確かめた時刻').nextElementSibling?.textContent).not.toBe(before))
    expect(screen.queryByText('現在準備中です')).toBeNull()
  })

  it('接続の確認に失敗したら表示中の状態と時刻を保つ', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({
      status: 'connected',
      storeName: '渋谷店',
      checkedAt: '2026-10-12T01:00:00.000Z',
    }))
    fixture.checkConnection.mockRejectedValue(new Error('失敗'))

    render(<DeliverySettingsPage />)
    expect(await screen.findByText('渋谷店')).toBeTruthy()
    const before = card('Uber Eats').getByText('最後に確かめた時刻').nextElementSibling?.textContent
    fireEvent.click(button('接続を確かめる'))

    expect(await screen.findByText(/表示中の接続状態は変更していません/)).toBeTruthy()
    expect(card('Uber Eats').getByText('接続中')).toBeTruthy()
    expect(card('Uber Eats').getByText('渋谷店')).toBeTruthy()
    expect(card('Uber Eats').getByText('最後に確かめた時刻').nextElementSibling?.textContent).toBe(before)
    expect(fixture.checkConnection).toHaveBeenCalledTimes(1)
  })

  it('接続確認で解除結果不明が分かったら接続操作を止める', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'connected', storeName: '渋谷店' }))
    fixture.checkConnection.mockRejectedValue(new ApiError(409, 'API error: 409', 'pos_deactivation_unknown'))

    render(<DeliverySettingsPage />)
    expect(await screen.findByText('渋谷店')).toBeTruthy()
    fireEvent.click(button('接続を確かめる'))

    expect(await screen.findByText(/連携を解除した結果を確認する必要があります/)).toBeTruthy()
    expect(card('Uber Eats').getByText('接続エラー')).toBeTruthy()
    expect((card('Uber Eats').getByRole('button', { name: '接続を確かめる' }) as HTMLButtonElement).disabled).toBe(true)
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('閲覧のみでOAuthから戻っても、候補の取得や変更窓を自動で開かない', async () => {
    fixture.role.value = 'staff'
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=pending_store'
    fixture.connection.mockResolvedValue(connection({ status: 'pending_store' }))
    fixture.stores.mockResolvedValue({ success: true, stores: STORES })
    render(<DeliverySettingsPage />)
    expect(screen.getByText(/閲覧のみ/)).toBeTruthy()
    expect(screen.queryByText('つなぐお店を選んでください')).toBeNull()
    expect(fixture.connection).not.toHaveBeenCalled()
    expect(fixture.stores).not.toHaveBeenCalled()
    expect(fixture.selectStore).not.toHaveBeenCalled()
  })

  it('LINE公式アカウントを替えた後は、前のアカウントの遅い確認結果を反映しない', async () => {
    fixture.accountId.value = 'account-a'
    fixture.connection.mockImplementation((accountId: string) => Promise.resolve(connection({
      status: 'connected',
      storeName: accountId === 'account-a' ? '店舗A' : '店舗B',
    })))
    const oldCheck = deferred<ReturnType<typeof connectionMutation>>()
    fixture.checkConnection.mockReturnValue(oldCheck.promise)
    const { rerender } = render(<DeliverySettingsPage />)
    expect(await screen.findByText('店舗A')).toBeTruthy()

    fireEvent.click(button('接続を確かめる'))
    expect(fixture.checkConnection).toHaveBeenCalledWith('account-a')
    fixture.accountId.value = 'account-b'
    rerender(<DeliverySettingsPage />)
    expect(await screen.findByText('店舗B')).toBeTruthy()

    await act(async () => oldCheck.resolve(connectionMutation({ status: 'connected', storeName: '古い店舗' })))
    expect(card('Uber Eats').getByText('店舗B')).toBeTruthy()
    expect(card('Uber Eats').queryByText('古い店舗')).toBeNull()
  })

  it('操作開始前の遅い読み取りは、同じアカウントの確定結果を上書きしない', async () => {
    fixture.accountId.value = 'acc-1'
    const oldLoad = deferred<ReturnType<typeof connection>>()
    fixture.connection.mockReturnValue(oldLoad.promise)
    fixture.checkConnection.mockResolvedValue(connectionMutation({ status: 'disconnected' }))
    render(<DeliverySettingsPage services={[uber({ status: 'connected', storeName: '渋谷店' })]} />)
    await waitFor(() => expect(fixture.connection).toHaveBeenCalledWith('acc-1'))

    fireEvent.click(button('接続を確かめる'))
    await waitFor(() => expect(card('Uber Eats').getByText('未接続')).toBeTruthy())
    await act(async () => oldLoad.resolve(connection({ status: 'connected', storeName: '古い店舗' })))

    expect(card('Uber Eats').getByText('未接続')).toBeTruthy()
    expect(card('Uber Eats').queryByText('古い店舗')).toBeNull()
  })

  it('閲覧のみへ変わった後は、開始済みの確認結果を反映しない', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.connection.mockResolvedValue(connection({ status: 'connected', storeName: '渋谷店' }))
    const oldCheck = deferred<ReturnType<typeof connectionMutation>>()
    fixture.checkConnection.mockReturnValue(oldCheck.promise)
    const { rerender } = render(<DeliverySettingsPage />)
    expect(await screen.findByText('渋谷店')).toBeTruthy()

    fireEvent.click(button('接続を確かめる'))
    fixture.role.value = 'staff'
    rerender(<DeliverySettingsPage />)
    expect(await screen.findByText(/閲覧のみ/)).toBeTruthy()
    await act(async () => oldCheck.resolve(connectionMutation({ status: 'connected', storeName: '古い店舗' })))

    expect(card('Uber Eats').getByText('渋谷店')).toBeTruthy()
    expect(card('Uber Eats').queryByText('古い店舗')).toBeNull()
    expect(card('Uber Eats').queryByRole('button', { name: '接続を確かめる' })).toBeNull()
    expect(card('Uber Eats').queryByRole('button', { name: '連携を解除する' })).toBeNull()
  })

  it('LINE公式アカウントを替えた後は、前のアカウントの遅い読み取りを反映しない', async () => {
    fixture.accountId.value = 'account-a'
    const oldLoad = deferred<ReturnType<typeof connection>>()
    fixture.connection.mockImplementation((accountId: string) => accountId === 'account-a'
      ? oldLoad.promise
      : Promise.resolve(connection({ status: 'connected', storeName: '店舗B' })))
    const { rerender } = render(<DeliverySettingsPage />)
    await waitFor(() => expect(fixture.connection).toHaveBeenCalledWith('account-a'))

    fixture.accountId.value = 'account-b'
    rerender(<DeliverySettingsPage />)
    expect(await screen.findByText('店舗B')).toBeTruthy()
    await act(async () => oldLoad.resolve(connection({ status: 'connected', storeName: '店舗A' })))

    expect(card('Uber Eats').getByText('店舗B')).toBeTruthy()
    expect(card('Uber Eats').queryByText('店舗A')).toBeNull()
  })

  it.each(['pos_activation_started', 'pos_activation_unknown'])('結果の照合が必要な%sは再表示しても再送の窓を開かない', async (lastError) => {
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=pending_store'
    const data = connection({ status: 'pending_store', storeName: '渋谷店', connectedAt: '2026-10-13T02:30:00.000Z', checkedAt: '2026-10-13T03:00:00.000Z' })
    fixture.connection.mockResolvedValue({ ...data, connection: { ...data.connection, lastError } })
    render(<DeliverySettingsPage />)
    expect(await screen.findByText(/送り直さず musubo へお知らせください/)).toBeTruthy()
    expect(card('Uber Eats').getByText('接続エラー')).toBeTruthy()
    expect(card('Uber Eats').queryByText('つないだお店')).toBeNull()
    expect(card('Uber Eats').queryByText('渋谷店')).toBeNull()
    expect(card('Uber Eats').getByText('—')).toBeTruthy()
    expect(screen.queryByText('つなぐお店を選んでください')).toBeNull()
    expect(fixture.stores).not.toHaveBeenCalled()
    expect(fixture.selectStore).not.toHaveBeenCalled()
    expect((card('Uber Eats').getByRole('button', { name: '接続を確かめる' }) as HTMLButtonElement).disabled).toBe(false)
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['pos_deactivation_started', 'pos_deactivation_unknown'])('解除結果の照合が必要な%sは接続先を残し、接続操作を止める', async (lastError) => {
    fixture.accountId.value = 'acc-1'
    const data = connection({ status: 'pending_store', storeName: '渋谷店', connectedAt: '2026-10-13T02:30:00.000Z' })
    fixture.connection.mockResolvedValue({ ...data, connection: { ...data.connection, lastError } })
    render(<DeliverySettingsPage />)

    expect(await screen.findByText(/連携を解除した結果を確認する必要があります/)).toBeTruthy()
    expect(card('Uber Eats').getByText('接続エラー')).toBeTruthy()
    expect(card('Uber Eats').getByText('渋谷店')).toBeTruthy()
    expect((card('Uber Eats').getByRole('button', { name: '接続を確かめる' }) as HTMLButtonElement).disabled).toBe(true)
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fixture.checkConnection).not.toHaveBeenCalled()
    expect(fixture.disconnect).not.toHaveBeenCalled()
  })

  it.each(['store_provision_review_required', 'store_menu_refresh_review_required'])('%sは店舗選択へ戻さず、安全な接続確認だけを残す', async (lastError) => {
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=pending_store'
    const data = connection({ status: 'pending_store', storeName: '渋谷店', connectedAt: '2026-10-13T02:30:00.000Z' })
    fixture.connection.mockResolvedValue({ ...data, connection: { ...data.connection, lastError } })
    render(<DeliverySettingsPage />)

    expect(await screen.findByText(/Uber Eats 側の接続状態を確認する必要があります/)).toBeTruthy()
    expect(card('Uber Eats').getByText('接続エラー')).toBeTruthy()
    expect(card('Uber Eats').getByText('渋谷店')).toBeTruthy()
    expect(screen.queryByText('つなぐお店を選んでください')).toBeNull()
    expect(fixture.stores).not.toHaveBeenCalled()
    expect(fixture.selectStore).not.toHaveBeenCalled()
    expect((card('Uber Eats').getByRole('button', { name: '接続を確かめる' }) as HTMLButtonElement).disabled).toBe(false)
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('再ログインから戻ったら店舗選択や解除を自動実行せず、接続確認の完了を待つ', async () => {
    fixture.accountId.value = 'acc-1'
    fixture.search.value = 'ubereats=reauthorized'
    const pending = connection({ status: 'pending_store', storeName: '渋谷店', connectedAt: '2026-10-13T02:30:00.000Z' })
    fixture.connection.mockResolvedValue({
      ...pending,
      connection: { ...pending.connection, lastError: 'pos_disconnect_reauthorization_pending' },
    })
    fixture.checkConnection.mockResolvedValue(connectionMutation({ status: 'connected', storeName: '渋谷店' }))
    render(<DeliverySettingsPage />)

    expect(await screen.findByText(/Uber Eats へのログインを更新しました/)).toBeTruthy()
    expect(screen.queryByText('つなぐお店を選んでください')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Uber Eats にログインし直す' })).toBeNull()
    expect(fixture.stores).not.toHaveBeenCalled()
    expect(fixture.disconnect).not.toHaveBeenCalled()
    expect((card('Uber Eats').getByRole('button', { name: '接続を確かめる' }) as HTMLButtonElement).disabled).toBe(false)
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(card('Uber Eats').getByRole('button', { name: '接続を確かめる' }))
    await waitFor(() => expect(card('Uber Eats').getByText('接続中')).toBeTruthy())
    expect((card('Uber Eats').getByRole('button', { name: '連携を解除する' }) as HTMLButtonElement).disabled).toBe(false)
    expect(fixture.checkConnection).toHaveBeenCalledTimes(1)
    expect(fixture.disconnect).not.toHaveBeenCalled()
  })

})
