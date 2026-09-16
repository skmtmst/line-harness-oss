// @vitest-environment happy-dom

/*
 * N-451 の実挙動試験。**`EmergencyPageInner` を実際に mount して、停止中に
 * 起きた変更（編集・削除・追加・期限切れ）が復旧確認の窓に理由つきで並ぶか、
 * 押した結果として口へ何を送るかを確かめる。**
 *
 *   - 部分復旧（partial）は「成功」ではなく警告として前面に出る
 *   - 409 OPERATION_RESTORE_BLOCKED は理由一覧を表示して止める
 *   - 差分の読み取りに失敗しても復旧自体は止まらない（口側が同じ検査をする）
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OperationCapability, OperationControl, OperationImpactPreview, OperationRestoreDrift, OperationRestoreReport } from '@/lib/api'
import EmergencyPage from './page'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const account = vi.hoisted(() => ({ id: 'account-1' as string | null }))

const calls = vi.hoisted(() => ({
  restore: [] as Array<{ incidentId: string, input: { confirmation: string, expectedVersion: number } }>,
  restorePreviewIncidentIds: [] as string[],
  restoreResult: null as null | (() => Promise<unknown>),
  restorePreviewResult: null as null | (() => Promise<unknown>),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/emergency',
  useSearchParams: () => new URLSearchParams('tab=control'),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [],
    selectedAccountId: account.id,
    selectedAccount: null,
    loading: false,
  }),
}))

const metric = (itemCount: number) => ({ itemCount, friendCount: itemCount * 2, pendingCount: 0 })

const STOPPED_STATES: OperationControl['states'] = {
  broadcast_dispatch: 'stopped',
  scenario_dispatch: 'stopped',
  reminder_dispatch: 'stopped',
  automation_actions: 'stopped',
  auto_reply_dispatch: 'stopped',
  webhook_outgoing: 'stopped',
  ad_postback: 'stopped',
}

const IMPACT: OperationImpactPreview = {
  broadcast_dispatch: metric(1),
  scenario_dispatch: metric(0),
  reminder_dispatch: metric(0),
  automation_actions: metric(0),
  auto_reply_dispatch: metric(0),
}

function previewPayload() {
  return {
    success: true as const,
    data: {
      control: {
        scopeKey: 'all',
        lineAccountId: null,
        version: 4,
        states: STOPPED_STATES,
        activeIncidentId: 'inc-1',
        reason: 'まとめて停止',
        actorId: 'admin-1',
        stoppedAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      } satisfies OperationControl,
      counts: {},
      impact: IMPACT,
      permissions: { canControl: true, reasonCode: null },
      calculatedAt: '2026-09-16T00:00:00.000Z',
    },
  }
}

function driftData(): OperationRestoreDrift {
  return {
    accountInactive: false,
    capabilities: [
      {
        capability: 'broadcast_dispatch',
        unchanged: [],
        blocked: true,
        drift: [
          { id: 'b-1', kind: 'changed', beforeVersion: '1', currentVersion: '2', currentStatus: 'scheduled', expiresAt: null },
          { id: 'b-2', kind: 'deleted', beforeVersion: '1', currentVersion: null, currentStatus: null, expiresAt: null },
          { id: 'b-3', kind: 'expired', beforeVersion: '1', currentVersion: '1', currentStatus: 'scheduled', expiresAt: '2000-01-01T00:00:00.000Z' },
        ],
      },
      { capability: 'scenario_dispatch', unchanged: ['sc-1'], blocked: false, drift: [] },
    ],
    resumable: ['scenario_dispatch', 'reminder_dispatch', 'automation_actions', 'auto_reply_dispatch', 'webhook_outgoing', 'ad_postback'],
    expired: [{ capability: 'broadcast_dispatch', id: 'b-3', expiresAt: '2000-01-01T00:00:00.000Z' }],
  }
}

function restorePreviewPayload() {
  return {
    success: true as const,
    data: {
      incidentId: 'inc-1',
      status: 'stopped' as const,
      capabilities: ['broadcast_dispatch', 'scenario_dispatch'] as OperationCapability[],
      drift: driftData(),
    },
  }
}

function restoredReport(partial: boolean): OperationRestoreReport {
  return {
    evaluatedAt: '2026-09-16T00:10:00.000Z',
    drift: driftData(),
    resumed: partial
      ? ['scenario_dispatch', 'reminder_dispatch', 'automation_actions', 'auto_reply_dispatch', 'webhook_outgoing', 'ad_postback']
      : Object.keys(STOPPED_STATES) as OperationCapability[],
    heldExpired: partial ? [{ capability: 'broadcast_dispatch', id: 'b-3', expiresAt: '2000-01-01T00:00:00.000Z' }] : [],
    remaining: partial ? ['broadcast_dispatch'] : [],
  }
}

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      health: {
        ...actual.api.health,
        accounts: () => Promise.resolve({ success: true as const, data: [{ id: 'account-1', name: 'アカウント1' }] }),
      },
      operations: {
        ...actual.api.operations,
        preview: () => Promise.resolve(previewPayload()) as Promise<never>,
        alerts: () => Promise.resolve({ success: true as const, data: [] }) as Promise<never>,
        stepUp: () => Promise.resolve({
          success: true as const,
          data: { token: 'step-up-token', purpose: 'operations.control' as const, expiresAt: '2026-09-16T00:05:00.000Z' },
        }) as Promise<never>,
        restorePreview: (incidentId: string) => {
          calls.restorePreviewIncidentIds.push(incidentId)
          return (calls.restorePreviewResult?.() ?? Promise.reject(new Error('restorePreview は用意されていません'))) as Promise<never>
        },
        restore: (incidentId: string, input: { confirmation: string, expectedVersion: number }) => {
          calls.restore.push({ incidentId, input })
          return (calls.restoreResult?.() ?? Promise.reject(new Error('restore は用意されていません'))) as Promise<never>
        },
      },
    },
  }
})

const { EmergencyPageInner } = EmergencyPage.__test

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function input(id: string): HTMLInputElement {
  const node = document.getElementById(id)
  if (!(node instanceof HTMLInputElement)) throw new Error(`#${id} がありません`)
  return node
}

async function runRestoreFlow() {
  fireEvent.click(screen.getByRole('button', { name: '復旧する' }))
  await flush()
  fireEvent.change(input('emergency-confirm-word'), { target: { value: '復旧' } })
  await flush()
  fireEvent.click(screen.getByRole('button', { name: '復旧を実行する' }))
  await flush()
  fireEvent.change(input('emergency-step-up-code'), { target: { value: '123456' } })
  await flush()
  fireEvent.click(screen.getByRole('button', { name: '本人確認して復旧' }))
  await flush()
}

afterEach(() => {
  cleanup()
  account.id = 'account-1'
  calls.restore.length = 0
  calls.restorePreviewIncidentIds.length = 0
  calls.restoreResult = null
  calls.restorePreviewResult = null
})

describe('停止中の変更を理由つきで見せて安全に復旧する(N-451)', () => {
  it('停止中のincidentを検知したら復旧前検査を取り、確認の窓にずれの理由を並べる', async () => {
    calls.restorePreviewResult = () => Promise.resolve(restorePreviewPayload())
    render(<EmergencyPageInner />)
    await flush()

    expect(calls.restorePreviewIncidentIds).toEqual(['inc-1'])

    fireEvent.click(screen.getByRole('button', { name: '復旧する' }))
    await flush()

    const text = document.body.textContent ?? ''
    expect(text).toContain('停止しているあいだに変わったものがあります')
    expect(text).toContain('予約中の一斉配信: 編集1件・期限切れ1件・削除1件')
    expect(text).toContain('変更・追加があった配信は再開しません')
    expect(text).toContain('期限切れの予約は下書きへ戻します')
  })

  it('部分復旧は「成功」ではなく警告として出し、期限切れは下書きへ戻したと伝える', async () => {
    calls.restorePreviewResult = () => Promise.resolve(restorePreviewPayload())
    calls.restoreResult = () => Promise.resolve({
      success: true as const,
      data: {
        status: 'partial' as const,
        control: previewPayload().data.control,
        incident: { id: 'inc-1', status: 'resolved' },
        report: restoredReport(true),
      },
    })
    render(<EmergencyPageInner />)
    await flush()

    await runRestoreFlow()

    expect(calls.restore).toHaveLength(1)
    expect(calls.restore[0]!.incidentId).toBe('inc-1')
    expect(calls.restore[0]!.input).toEqual({ confirmation: '復旧', expectedVersion: 4 })
    const text = document.body.textContent ?? ''
    expect(text).toContain('一部だけ復旧しました')
    expect(text).toContain('予約中の一斉配信は停止中の変更・追加があるため止めたままです')
    expect(text).toContain('期限を過ぎた予約1件は下書きへ戻しました')
    expect(text).not.toContain('サーバー共通の停止状態を復旧しました')
  })

  it('409 OPERATION_RESTORE_BLOCKED は理由を並べて表示し、復旧しない', async () => {
    const { ApiError } = await import('@/lib/api')
    calls.restorePreviewResult = () => Promise.resolve(restorePreviewPayload())
    calls.restoreResult = () => Promise.reject(new ApiError(409, '停止中に変更があるため、そのままでは復旧できません', 'OPERATION_RESTORE_BLOCKED', {
      report: { drift: driftData() },
    }))
    render(<EmergencyPageInner />)
    await flush()

    await runRestoreFlow()

    const text = document.body.textContent ?? ''
    expect(text).toContain('停止中に変更があるため、そのままでは復旧できません')
    expect(text).toContain('予約中の一斉配信: 編集1件のため再開を止めました')
    expect(calls.restore).toHaveLength(1)
  })

  it('差分の読み取りに失敗しても復旧自体は進み、全部戻ったときは成功として伝える', async () => {
    calls.restorePreviewResult = () => Promise.reject(new Error('network down'))
    calls.restoreResult = () => Promise.resolve({
      success: true as const,
      data: {
        status: 'restored' as const,
        control: previewPayload().data.control,
        incident: { id: 'inc-1', status: 'resolved' },
        report: restoredReport(false),
      },
    })
    render(<EmergencyPageInner />)
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '復旧する' }))
    await flush()
    expect(document.body.textContent ?? '').not.toContain('停止しているあいだに変わったものがあります')

    fireEvent.change(input('emergency-confirm-word'), { target: { value: '復旧' } })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '復旧を実行する' }))
    await flush()
    fireEvent.change(input('emergency-step-up-code'), { target: { value: '123456' } })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '本人確認して復旧' }))
    await flush()

    expect(calls.restore).toHaveLength(1)
    expect(document.body.textContent ?? '').toContain('サーバー共通の停止状態を復旧しました')
  })
})
