// @vitest-environment happy-dom
/*
 * DEEP-16 / DEEP-17 (#995): 予約メニュー新規作成の部分成功とアカウント切替。
 *
 * 監査の再現試験 (audit-deep-booking-menu.test.tsx) が示した2つの事故を、
 * 実物の React で描いて直っていることを確かめる。
 *
 *   - メニュー作成後に担当設定だけが失敗しても、もう一度ボタンを押しても
 *     createMenu を二度呼ばない（同名メニューの二重作成をしない）
 *   - 失敗した担当だけが残り、再試行はその人たちだけを処理する
 *   - アカウントを切り替えると前の担当選択と部分作成状態を残さない
 *   - 担当候補の取得中・未取得では作成しない
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  account: 'A' as string,
  create: vi.fn(),
  staff: vi.fn(),
  getMatrix: vi.fn(),
  putMatrix: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-capability', () => ({ canEditFeature: () => true }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: m.account }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push }) }))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    tags: { list: async () => ({ success: true, data: [] }) },
    mileage: { rules: async () => ({ success: true, data: [] }) },
  },
  bookingApi: {
    createMenu: m.create,
    listStaff: m.staff,
    getSettings: async () => ({ success: true, data: { menuCount: 1 } }),
    getStaffMenus: m.getMatrix,
    putStaffMenus: m.putMatrix,
  },
}))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  m.account = 'A'
  m.create.mockImplementation(async () => ({ id: `new-${m.create.mock.calls.length}` }))
  m.staff.mockImplementation(async (a: string) => ({
    staff: [{ id: `staff-${a}`, display_name: `担当${a}`, is_active: 1 }],
  }))
  // 実際の matrix には作成済みメニュー行も返る。空にすると新規行が
  // put へ乗らず、割当の中身を確かめられない。
  m.getMatrix.mockResolvedValue({
    matrix: [{ menu_id: 'new-1', is_offered: 0, override_duration_minutes: null, override_price: null }],
  })
  m.putMatrix.mockResolvedValue({ ok: true })
})

async function fillName() {
  await flush()
  fireEvent.change(screen.getByPlaceholderText('例: トリミング（小型犬）'), {
    target: { value: '検証メニュー' },
  })
}

describe('DEEP-16: 担当設定だけが失敗したあとの再実行', () => {
  it('再実行しても createMenu を二度呼ばず、残りの担当設定だけをやり直す', async () => {
    m.getMatrix.mockRejectedValueOnce(new Error('network'))
    render(<Page />)
    await fillName()
    fireEvent.click(screen.getByLabelText('担当A'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })

    // 部分成功を明示する: メニューは作成済み、作成ボタンは再開用に変わる。
    expect(screen.getByText(/メニューは作成済みですが/)).toBeTruthy()
    expect(screen.getByText(/新しいメニューは増えません/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'つくって出す' })).toBeNull()
    // 部分成功の間は「保存して続けて作る」も出さない（新規作成の再利用をしない）。
    expect(screen.queryByRole('button', { name: '保存して続けて作る' })).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '担当の設定をやり直す' }))
    })

    // 作成は1回だけ。再実行は担当設定（get→put）だけをやり直す。
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.getMatrix).toHaveBeenCalledTimes(2)
    expect(m.putMatrix).toHaveBeenCalledTimes(1)
    expect(m.putMatrix.mock.calls[0][1]).toBe('staff-A')
    expect(m.putMatrix.mock.calls[0][2]).toEqual([
      expect.objectContaining({ menu_id: 'new-1', is_offered: true }),
    ])
    // 全部終わったら一覧へ戻る。
    expect(m.push).toHaveBeenCalledWith('/booking/menus?highlight=new-1')
  })

  it('失敗した担当だけを残して再開し、成功した担当は送り直さない', async () => {
    m.staff.mockResolvedValue({
      staff: [
        { id: 'staff-1', display_name: '担当1', is_active: 1 },
        { id: 'staff-2', display_name: '担当2', is_active: 1 },
      ],
    })
    // 担当2の割当保存だけを落とす。
    m.putMatrix.mockImplementation(async (_a: string, staffId: string) => {
      if (staffId === 'staff-2') throw new Error('save failed')
      return { ok: true }
    })
    render(<Page />)
    await fillName()
    fireEvent.click(screen.getByLabelText('担当1'))
    fireEvent.click(screen.getByLabelText('担当2'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })
    expect(m.create).toHaveBeenCalledTimes(1)

    m.putMatrix.mockResolvedValue({ ok: true })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '担当の設定をやり直す' }))
    })

    // 成功した担当1へは再度 put しない。失敗した担当2だけをやり直す。
    const retriedStaff = m.putMatrix.mock.calls.slice(2).map((call) => call[1])
    expect(retriedStaff).toEqual(['staff-2'])
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.push).toHaveBeenCalledWith('/booking/menus?highlight=new-1')
  })
})

describe('DEEP-17: アカウント切替で前の担当を持ち込まない', () => {
  it('切替後に前アカウントの担当へ割当を送らない', async () => {
    const v = render(<Page />)
    await fillName()
    fireEvent.click(screen.getByLabelText('担当A'))

    m.account = 'B'
    await act(async () => { v.rerender(<Page />) })
    await flush()

    // 前アカウントの担当は候補にも選択にも残らない。
    expect(screen.queryByLabelText('担当A')).toBeNull()
    expect((screen.getByLabelText('担当B') as HTMLInputElement).checked).toBe(false)

    // 未選択のまま押しても作らない（0人のメニューを出さない）。
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })
    expect(screen.getByText(/担当できる人を1人以上選んでください/)).toBeTruthy()
    expect(m.create).not.toHaveBeenCalled()

    // 切替先の担当を選んでから作る。割当は B の担当にだけ行く。
    fireEvent.click(screen.getByLabelText('担当B'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })
    expect(m.create).toHaveBeenCalledWith('B', expect.anything())
    expect(m.create).toHaveBeenCalledTimes(1)
    for (const call of m.getMatrix.mock.calls) expect(call[0]).toBe('B')
    expect(m.getMatrix).not.toHaveBeenCalledWith('B', 'staff-A')
    expect(m.getMatrix).toHaveBeenCalledWith('B', 'staff-B')
  })

  it('担当候補の取得が終わるまで作成させない', async () => {
    m.staff.mockImplementation(() => new Promise(() => {}))
    render(<Page />)
    fireEvent.change(screen.getByPlaceholderText('例: トリミング（小型犬）'), {
      target: { value: '検証メニュー' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })
    expect(screen.getByText(/担当スタッフを読み込んでいます/)).toBeTruthy()
    expect(m.create).not.toHaveBeenCalled()
  })

  it('担当候補の取得に失敗したままでは作成させない', async () => {
    m.staff.mockRejectedValue(new Error('network'))
    render(<Page />)
    await flush()
    fireEvent.change(screen.getByPlaceholderText('例: トリミング（小型犬）'), {
      target: { value: '検証メニュー' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'つくって出す' }))
    })
    expect(screen.getByText(/担当スタッフを読み込めませんでした/)).toBeTruthy()
    expect(m.create).not.toHaveBeenCalled()
  })
})
