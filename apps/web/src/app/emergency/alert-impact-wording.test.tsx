// @vitest-environment happy-dom
/*
 * A32-01: 「不明」と「断定」の混在を直す契約。
 *
 * - 実測で裏付けられない影響（外部通知の不達・友だちの減少・配信の停滞）は
 *   「可能性」として案内し、断定しない。
 * - severity=unknown（データ不足・未取得）の異常では「影響の有無も未確認」と
 *   出し、実測失敗と同じ影響文を当てない。
 * - 期限切れ(stale)の実行結果は項目の判定を「未確認」へ倒し、古い結果である
 *   ことを本文へ明示する。
 */
import fs from 'node:fs'
import path from 'node:path'

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OperationAlert, OperationHealthSnapshot } from '@/lib/api'
import EmergencyPage from './page'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const healthResponse = vi.hoisted(() => ({
  handler: null as ((accountId: string) => Promise<unknown>) | null,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      operations: {
        ...actual.api.operations,
        health: (accountId: string) => (
          healthResponse.handler?.(accountId) ?? Promise.resolve({ success: false as const, error: 'no handler' })
        ) as Promise<never>,
        preview: () => Promise.resolve({ success: false as const, error: 'not prepared' }),
        alerts: () => Promise.resolve({ success: true as const, data: [] }),
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

function staleSnapshot(): { success: true; data: OperationHealthSnapshot } {
  return {
    success: true,
    data: {
      latestRun: {
        id: 'run-old',
        lineAccountId: 'account-1',
        scopeKey: 'account-1',
        windowStartedAt: '2026-09-19T14:20:00.000Z',
        source: 'scheduled',
        status: 'completed',
        overallStatus: 'normal',
        actorId: null,
        startedAt: '2026-09-19T14:20:00.000Z',
        completedAt: '2026-09-19T14:22:00.000Z',
        errorMessage: null,
        results: [{
          id: 'result-1',
          runId: 'run-old',
          checkKey: 'line_connection',
          status: 'normal',
          summary: 'LINE接続は正常です',
          value: null,
          threshold: null,
          source: 'account_health_logs',
          observedAt: '2026-09-03T00:00:00.000Z',
        }],
      },
      overallStatus: 'stale',
      lastCheckedAt: '2026-09-19T14:22:00.000Z',
      nextCheckAt: '2026-09-19T14:27:00.000Z',
      serverNow: '2026-09-22T00:00:00.000Z',
    },
  }
}

afterEach(() => {
  cleanup()
  healthResponse.handler = null
})

describe('A32-01: 根拠のない影響を断定しない', () => {
  it('外部通知の不達・友だちの減少・配信の停滞を断定する文が残っていない', () => {
    expect(PAGE).not.toContain('外部システムへの通知が届いていません。')
    expect(PAGE).not.toContain('友だちが急に減っています')
    expect(PAGE).not.toContain('予約した配信が時刻どおりに出ていません。')
    expect(PAGE).toContain('外部システムへの通知が届いていない可能性があります')
    expect(PAGE).toContain('友だちが急に減っている可能性があります')
    expect(PAGE).toContain('予約した配信が時刻どおりに出ていない可能性があります')
  })

  it('実測された注意の異常では影響を可能性として案内する', () => {
    render(<OperationAlertsPanel
      alerts={[alert()]}
      failed={false}
      busyId={null}
      onAcknowledge={vi.fn()}
      onRetry={vi.fn()}
    />)

    expect(screen.getByText('外部システムへの通知が届いていない可能性があります。')).toBeTruthy()
  })

  it('友だち変化の異常でも減少を断定せず可能性として案内する', () => {
    render(<OperationAlertsPanel
      alerts={[alert({ checkKey: 'friend_change', summary: '友だち数が大きく減少しています' })]}
      failed={false}
      busyId={null}
      onAcknowledge={vi.fn()}
      onRetry={vi.fn()}
    />)

    expect(screen.getByText(/友だちが急に減っている可能性があります/)).toBeTruthy()
    expect(screen.queryByText(/友だちが急に減っています/)).toBeNull()
  })

  it('確認できていない(unknown)異常では影響の有無も未確認と出す', () => {
    render(<OperationAlertsPanel
      alerts={[alert({
        severity: 'unknown',
        summary: '友だち変化の比較記録が足りません',
        checkKey: 'friend_change',
      })]}
      failed={false}
      busyId={null}
      onAcknowledge={vi.fn()}
      onRetry={vi.fn()}
    />)

    // 記録不足なのに「減っている可能性」すら断定調で出さない
    expect(screen.getByText('この項目はまだ確認できていないため、影響の有無も未確認です。')).toBeTruthy()
    expect(screen.queryByText(/友だちが急に減っている可能性があります/)).toBeNull()
  })
})

describe('A32-01: 期限切れ(stale)の健全性を現在の判定と混ぜない', () => {
  it('古い実行の項目は「未確認」へ倒し、本文に古い結果と明示する', async () => {
    healthResponse.handler = () => Promise.resolve(staleSnapshot())
    render(<HealthPanel accountId="account-1" manualRunRequest={0} onSeverity={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('古い結果です（再確認待ち）: LINE接続は正常です')).toBeTruthy()
    })
    // 全体の状態は「期限切れ」と分けて出し、過去の次回予定は案内しない
    expect(screen.getByText('期限切れ（再確認待ち）')).toBeTruthy()
    expect(screen.getByText(/自動確認が止まっている可能性があります/)).toBeTruthy()
    expect(screen.queryByText(/次は.*に自動で確かめます/)).toBeNull()
  })

  it('期限内の実行はこれまでどおり実測の判定を出す', async () => {
    const fresh = staleSnapshot()
    fresh.data.overallStatus = 'normal'
    healthResponse.handler = () => Promise.resolve(fresh)
    render(<HealthPanel accountId="account-1" manualRunRequest={0} onSeverity={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('LINE接続は正常です')).toBeTruthy()
    })
    expect(screen.queryByText(/古い結果です/)).toBeNull()
  })
})
