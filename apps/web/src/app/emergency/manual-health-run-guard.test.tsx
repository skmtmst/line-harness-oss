// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OperationHealthSnapshot } from '@/lib/api'
import EmergencyPage from './page'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const account = vi.hoisted(() => ({ id: 'account-1' as string | null }))

const deferredList = vi.hoisted(() => ({
  run: [] as Array<{ accountId: string, resolve: (value: unknown) => void, reject: (error: unknown) => void }>,
  read: [] as Array<{ accountId: string, resolve: (value: unknown) => void }>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/emergency',
  useSearchParams: () => new URLSearchParams('tab=health'),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [],
    selectedAccountId: account.id,
    selectedAccount: null,
    loading: false,
  }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      health: {
        ...actual.api.health,
        accounts: () => Promise.resolve({ success: true as const, data: [] }),
      },
      operations: {
        ...actual.api.operations,
        health: (accountId: string) => new Promise((resolve) => {
          deferredList.read.push({ accountId, resolve })
        }) as Promise<never>,
        runHealth: (accountId: string) => new Promise((resolve, reject) => {
          deferredList.run.push({ accountId, resolve, reject })
        }) as Promise<never>,
        preview: () => Promise.resolve({ success: false as const, error: 'not prepared' }),
        alerts: () => Promise.resolve({ success: true as const, data: [] }),
      },
    },
  }
})

const { EmergencyPageInner, HealthPanel } = EmergencyPage.__test

function snapshot(summary: string): { success: true, data: OperationHealthSnapshot } {
  return {
    success: true,
    data: {
      latestRun: {
        id: 'run-1',
        lineAccountId: account.id,
        source: 'manual',
        status: 'completed',
        overallStatus: 'normal',
        startedAt: '2026-09-16T00:00:00.000Z',
        completedAt: '2026-09-16T00:00:00.000Z',
        results: [{
          id: 'result-1',
          runId: 'run-1',
          checkKey: 'webhook',
          status: 'normal',
          summary,
          value: null,
          threshold: null,
          source: 'manual',
          observedAt: '2026-09-16T00:00:00.000Z',
        }],
      },
      overallStatus: 'normal',
      lastCheckedAt: '2026-09-16T00:00:00.000Z',
      nextCheckAt: null,
      serverNow: '2026-09-16T00:00:00.000Z',
    },
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  account.id = 'account-1'
  deferredList.run.length = 0
  deferredList.read.length = 0
})

describe('手動ヘルス確認の二重実行防止(N-458)', () => {
  it('同一レンダーでの連打・ダブルクリックは1リクエストだけ送り、処理中は無効化する', async () => {
    render(<EmergencyPageInner />)
    deferredList.read[0]?.resolve(snapshot('初回の確認'))
    await flush()

    const button = screen.getByRole('button', { name: '↻ いますぐ確かめる' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    await flush()

    expect(deferredList.run).toHaveLength(1)
    expect(deferredList.run[0]?.accountId).toBe('account-1')
    expect((screen.getByRole('button', { name: '↻ 確認中…' }) as HTMLButtonElement).disabled).toBe(true)

    // 別レンダー(応答待ちの間)に押しても増えない
    fireEvent.click(screen.getByRole('button', { name: '↻ 確認中…' }))
    await flush()
    expect(deferredList.run).toHaveLength(1)
  })

  it('成功後は操作が再び有効になり、次のクリックで新しい確認を送れる', async () => {
    render(<EmergencyPageInner />)
    deferredList.read[0]?.resolve(snapshot('初回の確認'))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '↻ いますぐ確かめる' }))
    await flush()
    expect(deferredList.run).toHaveLength(1)

    await act(async () => { deferredList.run[0]?.resolve(snapshot('手動の確認1')) })
    await flush()
    expect(((await screen.findByRole('button', { name: '↻ いますぐ確かめる' })) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '↻ いますぐ確かめる' }))
    await flush()
    expect(deferredList.run).toHaveLength(2)
  })

  it('失敗したら再試行だけできる', async () => {
    render(<EmergencyPageInner />)
    deferredList.read[0]?.resolve(snapshot('初回の確認'))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '↻ いますぐ確かめる' }))
    await flush()
    await act(async () => { deferredList.run[0]?.reject(new Error('network down')) })
    await flush()

    expect(((await screen.findByRole('button', { name: '↻ いますぐ確かめる' })) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '↻ いますぐ確かめる' }))
    await flush()
    expect(deferredList.run).toHaveLength(2)
  })

  it('アカウント切替で手動実行は発射せず、飛行中の古い応答は新しい表示を上書きしない', async () => {
    const { rerender } = render(<EmergencyPageInner />)
    deferredList.read[0]?.resolve(snapshot('初回の確認'))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '↻ いますぐ確かめる' }))
    await flush()
    expect(deferredList.run).toHaveLength(1)

    account.id = 'account-2'
    rerender(<EmergencyPageInner />)
    await flush()

    // 切替では runHealth を撃たず、通常の読み取りだけを要求する
    expect(deferredList.run).toHaveLength(1)
    expect(deferredList.read.at(-1)?.accountId).toBe('account-2')

    // 古いaccount-1の手動応答が遅れて届いても捨てる
    await act(async () => { deferredList.run[0]?.resolve(snapshot('旧アカウントの結果')) })
    await flush()
    expect(screen.queryByText('旧アカウントの結果')).toBeNull()

    await act(async () => { deferredList.read.at(-1)?.resolve(snapshot('新アカウントの結果')) })
    expect(await screen.findByText('新アカウントの結果')).toBeTruthy()

    // 手動実行が落ち着いたのでボタンは使える
    expect(((await screen.findByRole('button', { name: '↻ いますぐ確かめる' })) as HTMLButtonElement).disabled).toBe(false)
  })

  it('タブ往復の再マウントで処理済みの要求番号を手動実行として扱わない', async () => {
    // 以前クリックで3まで進んだ番号のまま HealthPanel が再マウントされた状況
    render(<HealthPanel
      accountId="account-1"
      manualRunRequest={3}
      onSeverity={vi.fn()}
      onManualRunSettled={vi.fn()}
    />)
    await flush()
    expect(deferredList.run).toHaveLength(0)
    expect(deferredList.read.at(-1)?.accountId).toBe('account-1')
  })

  it('確認中にアンマウントしてもロック解放コールバックが呼ばれ、例外にならない', async () => {
    const onSettled = vi.fn()
    const view = render(<HealthPanel
      accountId="account-1"
      manualRunRequest={0}
      onSeverity={vi.fn()}
      onManualRunSettled={onSettled}
    />)
    await flush()
    expect(deferredList.run).toHaveLength(0)
    view.rerender(<HealthPanel
      accountId="account-1"
      manualRunRequest={1}
      onSeverity={vi.fn()}
      onManualRunSettled={onSettled}
    />)
    await flush()
    expect(deferredList.run).toHaveLength(1)

    view.unmount()
    await act(async () => { deferredList.run[0]!.resolve(snapshot('遅れて届いた結果')) })
    await flush()
    expect(onSettled).toHaveBeenCalled()
  })
})
