// @vitest-environment happy-dom
/*
 * マイル「会員ランク」（G5-2）：段の表・動かす前の確かめ・閲覧のみの扱い。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ program: vi.fn(), preview: vi.fn(), save: vi.fn(), tiers: vi.fn(), activate: vi.fn(), stop: vi.fn() }))
const shell = vi.hoisted(() => ({ readonly: false }))
vi.mock('@/lib/api/helpers/gap3', () => ({ memberRanksApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/mileage', useSearchParams: () => new URLSearchParams('tab=ranks') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./frame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./frame')>()
  return { ...actual, useMileageShell: () => ({ tab: 'ranks', readonly: shell.readonly, narrow: false, counts: {}, setCount: () => {} }) }
})

const { default: RanksTab } = await import('./ranks')

const PROGRAM = {
  metric: 'visits', windowMonths: 12, status: 'stopped', version: 4, activatedAt: null, notificationsAvailable: false, notifyUpgrade: true, notifyDowngrade: true,
  tiers: [
    { id: 't1', name: 'ブロンズ', threshold: 0, mileMultiplier: 1 },
    { id: 't2', name: 'シルバー', threshold: 3, mileMultiplier: 1.2 },
    { id: 't3', name: 'ゴールド', threshold: 8, mileMultiplier: 1.5 },
  ],
}
const PREVIEW = { byTier: [{ tierId: 't1', name: 'ブロンズ', count: 780 }, { tierId: 't2', name: 'シルバー', count: 360 }, { tierId: 't3', name: 'ゴールド', count: 144 }], wouldUpgrade: 504, wouldDowngrade: 0 }

beforeEach(() => {
  shell.readonly = false
  api.program.mockResolvedValue({ success: true, data: PROGRAM })
  api.preview.mockResolvedValue({ success: true, data: PREVIEW })
  api.activate.mockResolvedValue({ success: true, data: { ...PROGRAM, status: 'active', version: 5 } })
  api.tiers.mockResolvedValue({ success: true, data: PROGRAM })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('会員ランクの表', () => {
  it('段ごとの上がる条件・下がる条件・特典・いまの人数を出し、止めている札と［動かす］を出す', async () => {
    render(<RanksTab />)
    await screen.findByText('シルバー')
    expect(screen.getByText('友だちになったら')).toBeTruthy()
    expect(screen.getByText('1 年で 3 回以上来店')).toBeTruthy()
    expect(screen.getByText('1 年で 3 回未満')).toBeTruthy()
    expect(screen.getByText('1.5 倍')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('360 人')).toBeTruthy())
    expect(screen.getByText('停止中')).toBeTruthy()
    expect(screen.getByRole('button', { name: '動かす' })).toBeTruthy()
  })

  it('［動かす］は確かめの窓に段ごとの人数と「最初は LINE を送りません」を出し、確かめたあとで動かす（版とキー付き）', async () => {
    render(<RanksTab />)
    await screen.findByText('シルバー')
    await waitFor(() => expect(screen.getByText('360 人')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '動かす' }))
    const dialog = await screen.findByRole('dialog', { name: '会員ランクを動かしますか？' })
    expect(dialog.textContent).toContain('最初は LINE を送りません')
    expect(dialog.textContent).toContain('144 人')
    expect(api.activate).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '動かす' })) })
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('a', 4, expect.any(String)))
  })

  it('閲覧のみの人には、足す・動かす・編集の操作を置かない', async () => {
    shell.readonly = true
    render(<RanksTab />)
    await screen.findByText('シルバー')
    expect(screen.queryByRole('button', { name: '動かす' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'ランクを足す' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'シルバーの操作' })).toBeNull()
  })

  it('知らせは試験運転と伝え、上がったとき・下がる前の設定を保存できる', async () => {
    api.save.mockResolvedValue({ success: true, data: PROGRAM })
    render(<RanksTab />)
    await screen.findByText('シルバー')
    expect(screen.getByText(/試験運転で、LINE へは送らず記録だけ/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: '下がる前に知らせる' })) })
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('a', expect.objectContaining({ notifyDowngrade: false, notifyUpgrade: true, expectedVersion: 4 })))
  })
})
