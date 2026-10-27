// @vitest-environment happy-dom
/*
 * テスト送信の窓（g2UNV）の、送り先を選ぶ段を描いて確かめる。
 * - 本番に何が起きないかを断り、送る通を1通ずつ（何通目・いつ）並べる
 * - 1通ごとの結果は作らず、繋がっていないことを書く
 * - 送り先を選ぶまで「内容を確認」を押せない。選んだあと、誰へ何通送るかを確かめてから送る
 * - 友だちはシナリオの LINE アカウント（共通なら選んでいるアカウント）から取る。読めなかったら読めなかったと出す
 * - 送るのに失敗しても、送信中のまま固まらず、もう一度送れる
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestSendDialog } from './scenario-dialogs'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const send = vi.hoisted(() => vi.fn())
const friendsList = vi.hoisted(() => vi.fn())
const preview = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: {
    friends: { list: friendsList },
    scenarios: { runs: vi.fn(async () => ({ success: true, data: { testSends: [] } })), testSend: send, testSendStep: send, preview },
    accountSettings: {
      getTestRecipientLoginUsers: vi.fn(async () => ({ success: true, data: [] })),
      getTestRecipients: vi.fn(async () => ({ success: true, data: [] })),
    },
  },
  ApiError: class extends Error {},
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'acc-selected',
    accounts: [{ id: 'acc-1', name: '本店' }, { id: 'acc-selected', name: '選択中' }],
  }),
}))

vi.mock('@/components/shared/condition-builder', () => ({
  default: () => null,
  isEmptyCondition: () => true,
  pruneCondition: (v: unknown) => v,
}))

const FRIEND = { id: 'customer-1', displayName: '試験 太郎' }
const STEPS = [
  { id: 'step-1', stepOrder: 1, timing: '購読開始から0日後 10:00', kind: 'テキスト' },
  { id: 'step-2', stepOrder: 2, timing: '1日後 20:00', kind: 'テキスト' },
]

type Props = Parameters<typeof TestSendDialog>[0]

function renderDialog(props: Partial<Props> = {}) {
  return render(
    <TestSendDialog scenarioId="sc-1" lineAccountId="acc-1" stepId={null} stepLabel="すべての通" steps={STEPS} onClose={vi.fn()} {...props} />,
  )
}

const confirmButton = () => screen.getByText('内容を確認').closest('button')!

beforeEach(() => {
  friendsList.mockResolvedValue({ success: true, data: { items: [FRIEND] } })
  send.mockResolvedValue({ success: true, data: { sent: 2 } })
  preview.mockResolvedValue({
    success: true,
    data: { startAt: '2026-09-21T00:00:00+09:00', steps: STEPS.map((s) => ({ stepOrder: s.stepOrder, deliveryAt: '2026-09-21T00:00:00+09:00', deliveryAtLabel: '', messageType: 'text', messageContent: `${s.stepOrder}通目の本文` })) },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('g2UNV 送り先を選ぶ段', () => {
  it('本番に何が起きないかを断り、送る通を何通目・いつで並べ、1通ごとの結果は作らない', async () => {
    renderDialog()
    await screen.findByText(FRIEND.displayName)
    expect(screen.getByText('本番の登録は増えません。配信予定も作りません。')).toBeTruthy()
    expect(screen.getByText('送る内容')).toBeTruthy()
    for (const step of STEPS) {
      const row = screen.getByText(`${step.stepOrder}通目`).parentElement!
      expect(row.textContent, step.id).toContain(step.timing)
    }
    expect(screen.getByText('1通ずつの結果はまだ繋がっていません。1通ごとの送信結果を返す取得口が接続されると表示されます。')).toBeTruthy()
  })

  it('送り先を選ぶまで「内容を確認」を押せず、選ぶと誰へ何通送るかの確認へ進む', async () => {
    renderDialog()
    await screen.findByText(FRIEND.displayName)
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(confirmButton())
    expect(screen.queryByText('選択した1名へ実際に送信しますか？')).toBeNull()
    fireEvent.click(screen.getByText(FRIEND.displayName))
    expect(confirmButton().disabled).toBe(false)
    fireEvent.click(confirmButton())
    await screen.findByText('選択した1名へ実際に送信しますか？')
    await act(async () => {})
    expect(document.body.textContent).toContain('試験 太郎さん（')
    expect(document.body.textContent).toContain('へ2通をテスト送信します。')
    expect(send).not.toHaveBeenCalled()
  })

  it('友だちはシナリオの LINE アカウントから取り、共通のシナリオは選んでいるアカウントから取る', async () => {
    renderDialog()
    await screen.findByText(FRIEND.displayName)
    expect(friendsList).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-1' }))
    cleanup()
    friendsList.mockClear()
    renderDialog({ lineAccountId: null })
    await screen.findByText(FRIEND.displayName)
    expect(friendsList).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-selected' }))
  })

  it('友だちを読めなかったら、読み込み中のままにせず読めなかったと出す', async () => {
    friendsList.mockRejectedValue(new Error('offline'))
    renderDialog()
    expect(await screen.findByText('友だちを読み込めませんでした。')).toBeTruthy()
    expect(screen.queryByText('友だちを読み込んでいます。')).toBeNull()
  })

  it('送るのに失敗しても送信中のまま固まらず、もう一度送れる', async () => {
    send.mockRejectedValueOnce(new Error('offline'))
    renderDialog()
    fireEvent.click(await screen.findByText(FRIEND.displayName))
    fireEvent.click(confirmButton())
    await screen.findByText('選択した1名へ実際に送信しますか？')
    await screen.findByText('1通目の本文')
    for (const check of document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) fireEvent.click(check)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByText('テストを送る').closest('button')!) })
    expect(send).toHaveBeenCalledTimes(1)
    await screen.findByText('処理できませんでした。もう一度お試しください。')
    const again = screen.getByText(/^(テストを送る|もう一度送る)$/).closest('button')!
    expect(again.disabled).toBe(false)
    expect(screen.queryByText('送信中…')).toBeNull()
    await act(async () => { fireEvent.click(again) })
    expect(send).toHaveBeenCalledTimes(2)
  })
})
