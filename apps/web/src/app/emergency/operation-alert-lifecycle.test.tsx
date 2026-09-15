// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OperationAlert } from '@/lib/api'
import EmergencyPage from './page'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const alertRequest = vi.hoisted(() => ({
  promise: null as Promise<unknown> | null,
  resolve: null as ((value: unknown) => void) | null,
  handler: null as ((accountId: string) => Promise<unknown>) | null,
  retry: null as ((accountId: string) => Promise<unknown>) | null,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      operations: {
        ...actual.api.operations,
        health: () => Promise.resolve({
          success: true as const,
          data: {
            latestRun: null,
            overallStatus: 'unknown' as const,
            lastCheckedAt: null,
            nextCheckAt: null,
            serverNow: '2026-09-16T00:00:00.000Z',
          },
        }),
        preview: () => Promise.resolve({ success: false as const, error: 'not prepared' }),
        alerts: (accountId: string) => (
          alertRequest.handler?.(accountId) ?? alertRequest.promise
        ) as Promise<never>,
        retryAlertNotifications: (_id: string, accountId: string) => (
          alertRequest.retry?.(accountId) ?? Promise.resolve({ success: true, data: { retried: 0 } })
        ) as Promise<never>,
      },
    },
  }
})

const { HealthPanel, OperationAlertsPanel } = EmergencyPage.__test

function alert(overrides: Partial<OperationAlert> = {}): OperationAlert {
  return {
    id: 'alert-1',
    lineAccountId: 'account-1',
    checkKey: 'webhook',
    status: 'open',
    severity: 'warning',
    summary: 'Webhook受信に失敗があります',
    sourceRunId: 'run-1',
    firstDetectedAt: '2026-09-16T00:00:00.000Z',
    lastDetectedAt: '2026-09-16T00:00:00.000Z',
    acknowledgedAt: null,
    acknowledgedById: null,
    acknowledgementNote: null,
    resolvedAt: null,
    version: 1,
    reopenedCount: 0,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    notification: { queued: 0, sending: 0, sent: 0, failed: 0, unconfigured: 0, total: 0 },
    events: [{
      id: 'event-1', action: 'opened', severity: 'warning', summary: 'Webhook受信に失敗があります',
      actorId: null, note: null, alertVersion: 1, createdAt: '2026-09-16T00:00:00.000Z',
    }],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  alertRequest.promise = null
  alertRequest.resolve = null
  alertRequest.handler = null
  alertRequest.retry = null
})

describe('運用異常の受領・通知再開UI', () => {
  it('未受領alertへメモを入力して受領できる', () => {
    const onAcknowledge = vi.fn()
    render(<OperationAlertsPanel
      alerts={[alert()]}
      failed={false}
      busyId={null}
      onAcknowledge={onAcknowledge}
      onRetry={vi.fn()}
    />)

    fireEvent.change(screen.getByLabelText('受領メモ（任意）'), { target: { value: 'Webhook設定を確認中' } })
    fireEvent.click(screen.getByRole('button', { name: '受領する' }))

    expect(onAcknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'alert-1', version: 1 }),
      'Webhook設定を確認中',
    )
  })

  it('送信失敗を成功表示せず、失敗した通知だけ再送へ戻せる', () => {
    const onRetry = vi.fn()
    const failedAlert = alert({
      notification: { queued: 0, sending: 0, sent: 1, failed: 2, unconfigured: 0, total: 3 },
    })
    render(<OperationAlertsPanel
      alerts={[failedAlert]}
      failed={false}
      busyId={null}
      onAcknowledge={vi.fn()}
      onRetry={onRetry}
    />)

    expect(screen.getByText('2件の通知が送れませんでした。再送できます。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '失敗した通知を再送する' }))
    expect(onRetry).toHaveBeenCalledWith(failedAlert)
  })

  it('取得失敗を異常なしへ倒さず、受領済みは再受領できない', () => {
    const { rerender } = render(<OperationAlertsPanel
      alerts={[]}
      failed
      busyId={null}
      onAcknowledge={vi.fn()}
      onRetry={vi.fn()}
    />)
    expect(screen.getByText(/異常の受領・通知記録を取得できませんでした/)).toBeTruthy()
    expect(screen.queryByText(/異常の記録はありません/)).toBeNull()

    rerender(<OperationAlertsPanel
      alerts={[alert({ status: 'acknowledged' })]}
      failed={false}
      busyId={null}
      onAcknowledge={vi.fn()}
      onRetry={vi.fn()}
    />)
    expect(screen.getByText('受領済み')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '受領する' })).toBeNull()
  })

  it('解消済みでも通知失敗を表示して再送できる', () => {
    const onRetry = vi.fn()
    const resolved = alert({
      status: 'resolved',
      resolvedAt: '2026-09-16T00:10:00.000Z',
      version: 2,
      notification: { queued: 0, sending: 0, sent: 0, failed: 1, unconfigured: 0, total: 1 },
      events: [{
        id: 'event-resolved', action: 'resolved', severity: 'warning', summary: 'Webhook受信は正常です',
        actorId: null, note: null, alertVersion: 2, createdAt: '2026-09-16T00:10:00.000Z',
      }],
    })
    render(<OperationAlertsPanel
      alerts={[resolved]}
      failed={false}
      busyId={null}
      onAcknowledge={vi.fn()}
      onRetry={onRetry}
    />)

    expect(screen.getByText('解消済み')).toBeTruthy()
    expect(screen.getByText('1件の通知が送れませんでした。再送できます。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '失敗した通知を再送する' }))
    expect(onRetry).toHaveBeenCalledWith(resolved)
  })

  it('通知対象0人・連絡先なしを送信成功にせず、設定後の再確認を出す', () => {
    const onRetry = vi.fn()
    const unconfigured = alert({
      notification: { queued: 0, sending: 0, sent: 0, failed: 0, unconfigured: 1, total: 0 },
    })
    render(<OperationAlertsPanel
      alerts={[unconfigured]}
      failed={false}
      busyId={null}
      onAcknowledge={vi.fn()}
      onRetry={onRetry}
    />)

    expect(screen.getByText(/1件の通知先が未設定です/)).toBeTruthy()
    expect(screen.queryByText(/0件の通知を送信しました/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '通知先を再確認する' }))
    expect(onRetry).toHaveBeenCalledWith(unconfigured)
  })

  it('account選択解除後に旧accountの遅いalert応答を表示しない', async () => {
    alertRequest.promise = new Promise((resolve) => { alertRequest.resolve = resolve })
    const { rerender } = render(<HealthPanel accountId="account-1" manualRunRequest={0} onSeverity={vi.fn()} />)

    rerender(<HealthPanel accountId={null} manualRunRequest={0} onSeverity={vi.fn()} />)
    await act(async () => {
      alertRequest.resolve?.({ success: true, data: [alert({ summary: '旧accountの異常' })] })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByText('旧accountの異常')).toBeNull()
      expect(screen.getAllByText(/LINEアカウントを選択してください/).length).toBeGreaterThan(0)
    })
  })

  it('旧accountの遅い通知再開が完了しても、新accountの表示を上書きしない', async () => {
    let resolveRetry: ((value: unknown) => void) | null = null
    alertRequest.handler = async (accountId) => ({
      success: true,
      data: [alert({
        id: `alert-${accountId}`,
        lineAccountId: accountId,
        summary: `${accountId}の異常`,
        notification: accountId === 'account-A'
          ? { queued: 0, sending: 0, sent: 0, failed: 1, unconfigured: 0, total: 1 }
          : { queued: 0, sending: 0, sent: 1, failed: 0, unconfigured: 0, total: 1 },
      })],
    })
    alertRequest.retry = () => new Promise((resolve) => { resolveRetry = resolve })
    const { rerender } = render(<HealthPanel accountId="account-A" manualRunRequest={0} onSeverity={vi.fn()} />)
    await screen.findByText('account-Aの異常')
    fireEvent.click(screen.getByRole('button', { name: '失敗した通知を再送する' }))

    rerender(<HealthPanel accountId="account-B" manualRunRequest={0} onSeverity={vi.fn()} />)
    await screen.findByText('account-Bの異常')
    await act(async () => {
      resolveRetry?.({ success: true, data: { retried: 1 } })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('account-Bの異常')).toBeTruthy()
      expect(screen.queryByText('account-Aの異常')).toBeNull()
      expect(screen.queryByText(/通知または通知先を再確認しました/)).toBeNull()
    })
  })
})
