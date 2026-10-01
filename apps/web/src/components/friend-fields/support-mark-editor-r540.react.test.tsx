// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R540: アカウント切替中に旧一覧を使った対応マーク作成。
 *
 * Aの一覧表示中にBへ切り替え、Bの一覧取得を待たずに作ると、
 * 古いAの一覧の件数が並び順に入り、遅れたAの応答でBの画面に
 * A由来の重複注意が出ていた。最新では古い応答を捨て、切替中は
 * 保存を押させない。
 */

const accountStore = vi.hoisted(() => ({ id: 'account-A' }))

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
  useAccount: () => ({ selectedAccountId: accountStore.id }),
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
  describeSaveFailure: () => '保存できませんでした。接続を確かめて、もう一度お試しください。',
}))
vi.mock('./support-mark-rules-panel', () => ({
  default: () => null,
}))

import SupportMarkEditor from './support-mark-editor'

function mark(id: string, name: string) {
  return {
    id,
    name,
    color: '#EF4B55',
    displayOrder: 0,
    isDefault: false,
    autoOnInbound: false,
    version: 1,
    friendCount: 0,
  }
}

function createButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '対応マークを作る' }) as HTMLButtonElement
}

beforeEach(() => {
  accountStore.id = 'account-A'
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
  fixture.marksCreate.mockResolvedValue({ success: true, data: { id: 'm-9' } })
  fixture.marksUpdate.mockResolvedValue({ success: true, data: { id: 'm-1' } })
  fixture.marksAutomationRules.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R540 切替中の古い一覧で作らない', () => {
  it('Bへ切り替えた直後は保存を押させず、新しい一覧が来たら進める', async () => {
    fixture.marksList.mockImplementation((account: string) =>
      account === 'account-A'
        ? Promise.resolve({ success: true, data: [] })
        : new Promise(() => {}),
    )
    const view = render(<SupportMarkEditor />)
    await screen.findByPlaceholderText('例：要確認')
    expect(createButton().disabled).toBe(false)

    accountStore.id = 'account-B'
    view.rerender(<SupportMarkEditor />)
    await screen.findByText('アカウントを切り替えています。一覧を読み込むまでお待ちください')
    expect(createButton().disabled).toBe(true)
    fireEvent.click(createButton())
    expect(fixture.marksCreate).not.toHaveBeenCalled()
  })

  it('遅れて届いたAの応答でBの表示・保存入力を上書きしない', async () => {
    let resolveA!: (value: unknown) => void
    const gateA = new Promise((resolve) => { resolveA = resolve })
    const aMarks = [mark('a-1', 'Aだけの名前'), mark('a-2', 'A2'), mark('a-3', 'A3'), mark('a-4', 'A4'), mark('a-5', 'A5')]
    const bMarks = [mark('b-1', 'Bだけの名前')]
    fixture.marksList.mockImplementation((account: string) =>
      account === 'account-A' ? gateA : Promise.resolve({ success: true, data: bMarks }),
    )
    const view = render(<SupportMarkEditor />)

    accountStore.id = 'account-B'
    view.rerender(<SupportMarkEditor />)
    // Bの一覧（1件）を受け付ける。並び順の初期値はBの件数になる。
    await waitFor(() => expect(createButton().disabled).toBe(false))

    // Aの遅延応答がB表示の後に届く。捨てるため、Bの内容のまま残る。
    resolveA({ success: true, data: aMarks })
    await waitFor(() => expect(fixture.marksList).toHaveBeenCalledTimes(2))
    // 少し待ってもBの受け付けがAで上書きされない。
    await new Promise((resolve) => setTimeout(resolve, 50))

    const nameBox = screen.getByPlaceholderText('例：要確認') as HTMLInputElement
    fireEvent.change(nameBox, { target: { value: 'Bだけの名前' } })
    // 重複の注意はBの一覧で見る（A由来の同名注意は出ない）。
    await screen.findByText(/同じ名前の対応マークがすでにあります/)
    fireEvent.change(nameBox, { target: { value: 'Aだけの名前' } })
    await waitFor(() => {
      expect(screen.queryByText(/同じ名前の対応マークがすでにあります/)).toBeNull()
    })

    fireEvent.change(nameBox, { target: { value: '新しいマーク' } })
    fireEvent.click(createButton())
    await waitFor(() => expect(fixture.marksCreate).toHaveBeenCalledTimes(1))
    // B宛てに、Bの件数を並び順として送る（Aの5件ではない）。
    expect(fixture.marksCreate).toHaveBeenCalledWith(
      'account-B',
      expect.objectContaining({ displayOrder: 1 }),
      expect.any(String),
    )
  })
})
