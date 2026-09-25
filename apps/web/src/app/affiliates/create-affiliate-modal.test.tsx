// @vitest-environment happy-dom
/*
 * アフィリエイター新規作成の保存経路（AFFILIATE-08）。
 *
 * 実物の React をマウントして操作する。ソース文字列の検査では次が固定できない。
 *   - 選択中のLINEアカウントが作成リクエストへ乗ること
 *     （載せないと feature-enforcement が LINE_ACCOUNT_REQUIRED で止め、作成が必ず失敗する）
 *   - 友だちを選ぶまで作成ボタンが押せないこと
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const fixture = vi.hoisted(() => ({
  createCalls: [] as Array<Record<string, unknown>>,
  listImpl: null as null | (() => Promise<unknown>),
  createImpl: null as null | (() => Promise<unknown>),
}))

vi.mock('@/lib/api', () => ({
  api: {
    friends: {
      list: () => fixture.listImpl!(),
    },
    affiliates: {
      create: (data: Record<string, unknown>) => {
        fixture.createCalls.push(data)
        return fixture.createImpl!()
      },
    },
  },
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    <a href={href} {...props}>{children}</a>,
}))

const { CreateAffiliateModal } = await import('./tabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT_ID = 'line-acc-stg-nen'

beforeEach(() => {
  fixture.createCalls.length = 0
  fixture.listImpl = async () => ({
    success: true,
    data: { items: [{ id: 'friend-kenta', displayName: 'Kenta Kawano(Obama)' }] },
  })
  fixture.createImpl = async () => ({
    success: true,
    data: { id: 'aff-new', name: 'Kenta Kawano(Obama)' },
    link: null,
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

async function selectFriend() {
  const input = screen.getByPlaceholderText('名前で検索...')
  fireEvent.change(input, { target: { value: 'Kenta' } })
  // 検索は250msデバウンス。
  await act(async () => { vi.advanceTimersByTime(300) })
  const option = await screen.findByText('Kenta Kawano(Obama)')
  fireEvent.click(option)
}

describe('CreateAffiliateModal', () => {
  test('友だちを選ぶまでは作成ボタンが押せない', () => {
    render(
      <CreateAffiliateModal accountId={ACCOUNT_ID} onClose={() => {}} onCreated={() => {}} />,
    )
    const submit = screen.getByRole('button', { name: '作成' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    expect(fixture.createCalls).toHaveLength(0)
  })

  test('作成リクエストへ選択中のLINEアカウントを乗せる', async () => {
    const onClose = vi.fn()
    render(
      <CreateAffiliateModal accountId={ACCOUNT_ID} onClose={onClose} onCreated={() => {}} />,
    )
    await selectFriend()
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    await waitFor(() => expect(fixture.createCalls).toHaveLength(1))
    expect(fixture.createCalls[0]).toMatchObject({
      friendId: 'friend-kenta',
      lineAccountId: ACCOUNT_ID,
    })
    // リンク無し応答では成功後に閉じる。
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  test('サーバーの失敗文言をそのまま出して作成を送り直せる', async () => {
    fixture.createImpl = async () => ({
      success: false,
      error: 'LINEアカウントを指定してください',
    })
    render(
      <CreateAffiliateModal accountId={ACCOUNT_ID} onClose={() => {}} onCreated={() => {}} />,
    )
    await selectFriend()
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    await screen.findByText('LINEアカウントを指定してください')
    expect((screen.getByRole('button', { name: '作成' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('閉じる操作（監査7 #809）', () => {
  test('ダイアログは右上の×だけで閉じる。フッターに「閉じる」は置かない', () => {
    render(
      <CreateAffiliateModal accountId={ACCOUNT_ID} onClose={() => {}} onCreated={() => {}} />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // 「閉じる」という名前の操作は×の1個だけ。フォームの「キャンセル」は別物。
    expect(screen.getAllByRole('button', { name: '閉じる' })).toHaveLength(1)
  })

  test('リンク発行後もフッターの「閉じる」は出ず、×で閉じる', async () => {
    fixture.createImpl = async () => ({
      success: true,
      data: { id: 'aff-new', name: 'Kenta Kawano(Obama)' },
      link: { url: 'https://lin.ee/issued-1' },
    })
    const onClose = vi.fn()
    render(
      <CreateAffiliateModal accountId={ACCOUNT_ID} onClose={onClose} onCreated={() => {}} />,
    )
    await selectFriend()
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    // 発行済みリンクが見える状態（成功画面）
    await screen.findByDisplayValue('https://lin.ee/issued-1')
    expect(screen.getAllByRole('button', { name: '閉じる' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalled()
  })
})
