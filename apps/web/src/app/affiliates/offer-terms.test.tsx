// @vitest-environment happy-dom
/*
 * G-2 案件の決まり（#823）の描画試験と入力の確かめ。
 * 読み込み中・失敗・正常（上限あり・上限なし・上限到達）の状態を見る。
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  capStatusImpl: null as null | (() => Promise<unknown>),
  versionsImpl: null as null | (() => Promise<unknown>),
}))

vi.mock('@/lib/api', () => ({
  api: {
    affiliateOffers: {
      capStatus: () => fixture.capStatusImpl!(),
      versions: () => fixture.versionsImpl!(),
    },
  },
}))

const { default: OfferTermsDialog } = await import('./offer-terms')
const { parseOfferTermsInput } = await import('./offer-terms')

const OFFER = {
  id: 'off-1',
  name: '定期便',
  description: null,
  rewardAmount: 1000,
  rewardMiles: 50,
  mileageProgramId: 'default',
  lineAccountId: 'account-1',
  tagId: null,
  scenarioId: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000+09:00',
}

const STATUS = {
  version: {
    id: 'ver-2',
    offerId: 'off-1',
    versionNumber: 2,
    rewardAmount: 1000,
    rewardMiles: 50,
    windowDays: 30,
    capTotal: 200,
    capMonthlyPerAffiliate: 10,
    receptionFrom: '2026-10-01T00:00:00.000+09:00',
    receptionTo: '2026-12-31T23:59:59.000+09:00',
    effectiveFrom: null,
    createdAt: '2026-09-27T00:00:00.000+09:00',
  },
  capped: false,
  capTotal: 200,
  totalUsed: 162,
  totalRemaining: 38,
  capMonthlyPerAffiliate: 10,
  monthlyUsed: 3,
  monthlyRemaining: 7,
}

const VERSIONS = [
  STATUS.version,
  {
    ...STATUS.version,
    id: 'ver-1',
    versionNumber: 1,
    capTotal: null,
    capMonthlyPerAffiliate: null,
    receptionFrom: null,
    receptionTo: null,
    createdAt: '2026-09-01T00:00:00.000+09:00',
  },
]

function mockOk(status: unknown = STATUS, versions: unknown = VERSIONS) {
  fixture.capStatusImpl = () => Promise.resolve({ success: true, data: status })
  fixture.versionsImpl = () => Promise.resolve({ success: true, data: versions })
}

beforeEach(() => {
  mockOk()
})

afterEach(() => {
  cleanup()
})

describe('OfferTermsDialog', () => {
  test('読み込み中はその旨を出す', () => {
    fixture.capStatusImpl = () => new Promise(() => {})
    fixture.versionsImpl = () => new Promise(() => {})
    render(<OfferTermsDialog offer={OFFER} onClose={() => {}} />)
    expect(screen.getByText('決まりを読み込んでいます')).toBeTruthy()
  })

  test('失敗は1つの帯で出し、再試行できる', async () => {
    fixture.capStatusImpl = () => Promise.reject(new Error('network'))
    fixture.versionsImpl = () => Promise.reject(new Error('network'))
    render(<OfferTermsDialog offer={OFFER} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('決まりを読み込めませんでした')).toBeTruthy()
    })
    mockOk()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => {
      expect(screen.getByText('上限まであと38件')).toBeTruthy()
    })
  })

  test('正常は報酬・期間・上限・受付・残り・履歴を出す', async () => {
    render(<OfferTermsDialog offer={OFFER} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('上限まであと38件')).toBeTruthy()
    })
    expect(screen.getByText(/リンクを開いてから 30日/)).toBeTruthy()
    expect(screen.getByText(/この案件で200件/)).toBeTruthy()
    expect(screen.getByText('2026/10/01〜2026/12/31')).toBeTruthy()
    expect(screen.getByText(/版2/)).toBeTruthy()
    expect(screen.getByText(/版1/)).toBeTruthy()
  })

  test('上限なしは上限なしと出す（0と混ぜない）', async () => {
    mockOk(
      {
        ...STATUS,
        version: { ...STATUS.version, capTotal: null, capMonthlyPerAffiliate: null },
        capTotal: null,
        totalRemaining: null,
        capMonthlyPerAffiliate: null,
        monthlyRemaining: null,
      },
      [],
    )
    render(<OfferTermsDialog offer={OFFER} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('上限なし')).toBeTruthy()
    })
  })

  test('上限到達は受付停止の注意を出す', async () => {
    mockOk({ ...STATUS, capped: true, totalUsed: 200, totalRemaining: 0 })
    render(<OfferTermsDialog offer={OFFER} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/上限に達したため、受付を止めています/)).toBeTruthy()
    })
    expect(screen.getByText('上限に達しました')).toBeTruthy()
  })
})

describe('parseOfferTermsInput', () => {
  const base = {
    windowDays: '30',
    capTotal: '200',
    capMonthly: '10',
    receptionFrom: '2026-10-01',
    receptionTo: '2026-12-31',
  }

  test('正しい入力は版の形になる', () => {
    const { terms, error } = parseOfferTermsInput(base)
    expect(error).toBeNull()
    expect(terms).toMatchObject({
      windowDays: 30,
      capTotal: 200,
      capMonthlyPerAffiliate: 10,
      receptionFrom: '2026-10-01T00:00:00.000+09:00',
      receptionTo: '2026-12-31T23:59:59.000+09:00',
    })
  })

  test('空の上限・受付は「なし」になる', () => {
    const { terms, error } = parseOfferTermsInput({
      windowDays: '',
      capTotal: '',
      capMonthly: '',
      receptionFrom: '',
      receptionTo: '',
    })
    expect(error).toBeNull()
    expect(terms).toMatchObject({
      capTotal: null,
      capMonthlyPerAffiliate: null,
      receptionFrom: null,
      receptionTo: null,
    })
    expect(terms.windowDays).toBeUndefined()
  })

  test('壊れた値は人の言葉で返す', () => {
    expect(parseOfferTermsInput({ ...base, windowDays: '400' }).error).toContain('1〜365日')
    expect(parseOfferTermsInput({ ...base, capTotal: '0' }).error).toContain('全体の上限')
    expect(
      parseOfferTermsInput({ ...base, receptionFrom: '2026-12-31', receptionTo: '2026-10-01' }).error,
    ).toContain('終わりは始めより後')
  })
})
