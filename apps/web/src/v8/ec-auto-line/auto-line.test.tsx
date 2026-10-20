// @vitest-environment happy-dom
/*
 * EC連携「自動の LINE」（G6-1）：3つの種類・オンにする確かめ・閲覧のみの扱い・準備中の窓。
 * 受け口は試験運転だけ（LINE へは送らない）。表と確かめの窓の言葉がそれを伝えていることも見張る。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  rules: vi.fn(), sends: vi.fn(), save: vi.fn(), enableMock: vi.fn(), test: vi.fn(),
}))
vi.mock('@/lib/api/helpers/gap3', () => ({ ecAutoLineApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/ec-commerce', useSearchParams: () => new URLSearchParams() }))

const { default: EcAutoLine } = await import('./auto-line')

const RULES = [
  { kind: 'cart', enabled: true, waitMinutes: 60, messages: [{ type: 'text', text: '{{name}} さま' }], version: 3, testMode: true },
  { kind: 'browse', enabled: false, waitMinutes: 1440, messages: [], version: 1, testMode: true },
  { kind: 'restock', enabled: true, waitMinutes: 0, messages: [], version: 2, testMode: true },
]

beforeEach(() => {
  api.rules.mockResolvedValue({ success: true, data: RULES })
  api.sends.mockImplementation(async (_a: string, kind: string) => ({ success: true, data: { items: [], total: kind === 'cart' ? 214 : kind === 'restock' ? 96 : 0 } }))
  api.save.mockResolvedValue({ success: true, data: RULES[0] })
  api.enableMock.mockResolvedValue({ success: true, data: RULES[1] })
  api.test.mockResolvedValue({ success: true, data: { preview: RULES[0], sent: false, testMode: true } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('自動の LINE の表', () => {
  it('3つの種類の待つ時間と、試験運転で記録した送った数を出す。クリック・購入・金額は「—」', async () => {
    render(<EcAutoLine accountId="a" canEdit />)
    await screen.findByText('カゴ落ち')
    expect(screen.getByText('閲覧落ち')).toBeTruthy()
    expect(screen.getByText('再入荷')).toBeTruthy()
    expect(screen.getByText('1 時間')).toBeTruthy()
    expect(screen.getByText('すぐ')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('214 件')).toBeTruthy())
    expect(screen.getByText('96 件')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(9)
    expect(screen.getByText(/試験運転・実際に送った 0 件/)).toBeTruthy()
  })

  it('オンにするときは確かめの窓を出し、「LINE へは送らない」と伝える。確かめたら試験運転としてオンにする', async () => {
    render(<EcAutoLine accountId="a" canEdit />)
    await screen.findByText('閲覧落ち')
    fireEvent.click(screen.getByRole('switch', { name: '閲覧落ちの自動の LINE' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('LINE へは送らず')
    expect(api.enableMock).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'オンにする' })) })
    await waitFor(() => expect(api.enableMock).toHaveBeenCalledWith('a', 'browse', 1, expect.any(String)))
  })

  it('オフにするときは確かめなしで、いまの版を添えて保存する', async () => {
    render(<EcAutoLine accountId="a" canEdit />)
    await screen.findByText('カゴ落ち')
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'カゴ落ちの自動の LINE' })) })
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('a', 'cart', expect.objectContaining({ enabled: false, expectedVersion: 3 })))
  })

  it('閲覧のみの人には、スイッチも「…」も置かず、状態を札で見せる', async () => {
    render(<EcAutoLine accountId="a" canEdit={false} />)
    await screen.findByText('カゴ落ち')
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /の操作$/ })).toBeNull()
    expect(screen.getAllByText('オン').length).toBeGreaterThan(0)
  })

  it('計測の入れ方は口が無いので「現在準備中です」の窓を出す', async () => {
    render(<EcAutoLine accountId="a" canEdit />)
    await screen.findByText('カゴ落ち')
    fireEvent.click(screen.getByRole('button', { name: '入れ方を見る' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('現在準備中です')
  })

  it('読み込みに失敗したら「もう一度」を出す', async () => {
    api.rules.mockRejectedValueOnce(new Error('down'))
    render(<EcAutoLine accountId="a" canEdit />)
    expect(await screen.findByRole('button', { name: /もう一度/ })).toBeTruthy()
  })
})
