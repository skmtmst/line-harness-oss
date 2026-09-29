// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  marksList: vi.fn(),
  marksCreate: vi.fn(),
  marksUpdate: vi.fn(),
  marksAutomationRules: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1' }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    supportMarks: {
      list: fixture.marksList,
      create: fixture.marksCreate,
      update: fixture.marksUpdate,
      automationRules: fixture.marksAutomationRules,
    },
  },
  describeSaveFailure: (reason: unknown) => {
    const status = (reason as { status?: number } | null)?.status
    if (status === 403) return 'このLINEアカウントや権限では保存できません。選んでいるアカウントと権限を確認してください。'
    return '保存できませんでした。接続を確かめて、もう一度お試しください。'
  },
}))
vi.mock('./support-mark-rules-panel', () => ({
  default: () => null,
}))

import SupportMarkEditor from './support-mark-editor'

const oldMark = {
  id: 'm-1',
  name: '旧名',
  color: '#EF4B55',
  displayOrder: 4,
  isDefault: false,
  autoOnInbound: false,
  version: 1,
  friendCount: 0,
}

function createButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '対応マークを作る' }) as HTMLButtonElement
}

beforeEach(() => {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
    },
    configurable: true,
    writable: true,
  })
  fixture.marksList.mockResolvedValue({ success: true, data: [] })
  fixture.marksCreate.mockResolvedValue({ success: true, data: { id: 'm-9' } })
  fixture.marksUpdate.mockResolvedValue({ success: true, data: { id: 'm-1' } })
  fixture.marksAutomationRules.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R510 一覧の読込失敗中は作成を止め、その場で再試行する', () => {
  it('失敗中は作成ボタンを押せず、再試行の成功で入力を残したまま進める', async () => {
    fixture.marksList.mockRejectedValueOnce(new Error('network down'))
    render(<SupportMarkEditor />)
    await screen.findByText('対応マークを読み込めませんでした')
    expect(createButton().disabled).toBe(true)
    expect(fixture.marksCreate).not.toHaveBeenCalled()

    const nameBox = screen.getByPlaceholderText('例：要確認') as HTMLInputElement
    fireEvent.change(nameBox, { target: { value: '再試行する名前' } })

    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => expect(createButton().disabled).toBe(false))
    expect((screen.getByPlaceholderText('例：要確認') as HTMLInputElement).value).toBe('再試行する名前')
    expect(fixture.marksCreate).not.toHaveBeenCalled()

    fireEvent.click(createButton())
    await waitFor(() => expect(fixture.marksCreate).toHaveBeenCalledTimes(1))
    expect(fixture.routerPush).toHaveBeenCalledWith('/tags?tab=marks')
  })
})

describe('R511 権限のない担当者に作成を案内しない', () => {
  it('一覧の403では作成ボタンを出さず、理由だけ出す', async () => {
    fixture.marksList.mockRejectedValueOnce({ status: 403 })
    render(<SupportMarkEditor />)
    await screen.findByText('対応マークを作る権限がありません。オーナーか管理者に確認してください。')
    expect(screen.queryByRole('button', { name: '対応マークを作る' })).toBeNull()
  })

  it('役割がstaffと分かっているときも作成を案内しない', async () => {
    window.localStorage.setItem('lh_staff_role', 'staff')
    render(<SupportMarkEditor />)
    await screen.findByText('対応マークを作る権限がありません。オーナーか管理者に確認してください。')
    expect(screen.queryByRole('button', { name: '対応マークを作る' })).toBeNull()
    expect(fixture.marksCreate).not.toHaveBeenCalled()
  })

  it('保存の403は権限不足と伝え、以後は押させない', async () => {
    render(<SupportMarkEditor />)
    await screen.findByPlaceholderText('例：要確認')
    fixture.marksCreate.mockRejectedValueOnce({ status: 403 })
    fireEvent.click(createButton())
    await screen.findByText('このLINEアカウントや権限では保存できません。選んでいるアカウントと権限を確認してください。')
    expect(createButton().disabled).toBe(true)
    expect(fixture.marksCreate).toHaveBeenCalledTimes(1)
  })
})

describe('R512 応答消失後の再試行は同じ要求キーで送る', () => {
  it('入力を変えない再試行は同じキー、変えたら新しいキーになる', async () => {
    render(<SupportMarkEditor />)
    await screen.findByPlaceholderText('例：要確認')
    fixture.marksCreate.mockRejectedValueOnce(new Error('response lost'))
    fireEvent.click(createButton())
    await screen.findByText('保存できませんでした。接続を確かめて、もう一度お試しください。')
    expect(fixture.marksCreate).toHaveBeenCalledTimes(1)
    const firstKey = fixture.marksCreate.mock.calls[0][2] as string
    expect(typeof firstKey).toBe('string')

    fixture.marksCreate.mockResolvedValueOnce({ success: true, data: { id: 'm-9' } })
    fireEvent.click(createButton())
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/tags?tab=marks'))
    const secondKey = fixture.marksCreate.mock.calls[1][2] as string
    // 入力を変えていない再試行は同じ要求キーで送る（二重に作らない）。
    expect(secondKey).toBe(firstKey)
  })

  it('入力を変えたら別の要求として送る', async () => {
    render(<SupportMarkEditor />)
    const nameBox = await screen.findByPlaceholderText('例：要確認') as HTMLInputElement
    fixture.marksCreate.mockRejectedValueOnce(new Error('response lost'))
    fireEvent.click(createButton())
    await screen.findByText('保存できませんでした。接続を確かめて、もう一度お試しください。')
    const firstKey = fixture.marksCreate.mock.calls[0][2] as string

    fireEvent.change(nameBox, { target: { value: '変えた名前' } })
    fixture.marksCreate.mockResolvedValueOnce({ success: true, data: { id: 'm-10' } })
    fireEvent.click(createButton())
    await waitFor(() => expect(fixture.marksCreate).toHaveBeenCalledTimes(2))
    const secondKey = fixture.marksCreate.mock.calls[1][2] as string
    expect(secondKey).not.toBe(firstKey)
  })
})

describe('R513 古い版の保存は止めて最新と比べられる', () => {
  it('409では入力を残したまま最新の名前を見せ、取り込める', async () => {
    fixture.marksList.mockResolvedValue({ success: true, data: [oldMark] })
    render(<SupportMarkEditor markId="m-1" />)
    const nameBox = await screen.findByPlaceholderText('例：要確認') as HTMLInputElement
    expect(nameBox.value).toBe('旧名')
    fireEvent.change(nameBox, { target: { value: 'Aの名前' } })

    fixture.marksUpdate.mockRejectedValueOnce({
      status: 409,
      code: 'SUPPORT_MARK_VERSION_CONFLICT',
      data: { latest: { name: 'Bの名前', color: '#2563D4', displayOrder: 5, version: 2 } },
    })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await screen.findByText('ほかの担当者が先に変更しました。最新の内容を確認してから保存し直してください。')
    // 入力は残り、最新の名前が見える。
    expect((screen.getByPlaceholderText('例：要確認') as HTMLInputElement).value).toBe('Aの名前')
    expect(screen.getByText(/Bの名前/)).not.toBeNull()
    // 読んだ版（1）を送っていた。
    expect(fixture.marksUpdate).toHaveBeenCalledWith(
      'm-1', 'account-1', expect.objectContaining({ expectedVersion: 1 }),
    )

    fireEvent.click(screen.getByRole('button', { name: '最新の内容を取り込む' }))
    expect((screen.getByPlaceholderText('例：要確認') as HTMLInputElement).value).toBe('Bの名前')

    fixture.marksUpdate.mockResolvedValueOnce({ success: true, data: { id: 'm-1' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await waitFor(() => expect(fixture.marksUpdate).toHaveBeenCalledTimes(2))
    // 最新の版（2）で送り直す。
    expect(fixture.marksUpdate).toHaveBeenLastCalledWith(
      'm-1', 'account-1', expect.objectContaining({ expectedVersion: 2 }),
    )
  })
})
