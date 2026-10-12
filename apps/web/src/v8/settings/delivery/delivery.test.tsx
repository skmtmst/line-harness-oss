// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeliverySettingsPage, { SERVICES, type DeliveryService } from './delivery'

/**
 * 設定 › デリバリー連携（`dF4Ov` ／ `OIY4Z` ／ `kJLks` ／ `X5d8UF`、2026-10-12 利用者承認）の退行試験。
 *
 * 承認された範囲では3社の `ready` が false で、画面のボタンは押せない。
 * 接続後の段（`OIY4Z`）と2つの窓（`kJLks` ／ `X5d8UF`）は各社の返事が来てから動く経路なので、
 * ここでは入口の値を差し替えて、そのときに出る表示と状態の変わり方を固定する。
 */

const fixture = vi.hoisted(() => ({ role: { value: 'owner' as string | null } }))

vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => fixture.role.value,
  canManageRole: (role: string | null) => role === 'owner' || role === 'admin',
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
  useHideSettingsNav: () => {},
}))

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
  vi.resetAllMocks()
})

describe('設定 › デリバリー連携', () => {
  it('DL-1：3社が承認どおりの順で出て、つなぐボタンは押せない', () => {
    render(<DeliverySettingsPage />)

    // 画面の題も h2 なので、箱の題だけを取り出して並びを見る。
    const titles = screen
      .getAllByRole('region')
      .map((region) => region.querySelector('h2')?.textContent)
    expect(titles).toEqual(['Uber Eats', '出前館', 'ロケットナウ'])
    expect(screen.getAllByText('未接続')).toHaveLength(3)

    const login = button('Uber Eats にログインしてつなぐ')
    expect(login.disabled).toBe(true)
    expect(login.title).toContain('musubo が各デリバリーサービスへ連携のお手続きを進めています')
    expect(screen.getAllByRole('button', { name: '連携を申し込む' }).every((apply) => (apply as HTMLButtonElement).disabled)).toBe(true)
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
