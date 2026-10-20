import { fetchApi } from '../transport/request'
import type { ApiResponse, LineAccount, AccountHealthLog, AccountMigration } from '@line-crm/shared'
import type { AccountHealthSummary } from '../types/publication-types'
import type {
  LineWebhookRecoveryEvent,
  OperationHealthSnapshot,
  OperationAlert,
  OperationControl,
  OperationCapability,
  OperationImpactPreview,
  OperationHistoryEntry,
  OperationSendPathsResponse,
  OperationIncident,
  OperationRestoreDrift,
  OperationRestoreReport,
} from '../types/operations'

export const operationsMethods = {
  health: {
    accounts: () =>
      fetchApi<ApiResponse<LineAccount[]>>('/api/line-accounts'),
    getHealth: (accountId: string) =>
      fetchApi<ApiResponse<{ riskLevel: string; logs: AccountHealthLog[] }>>(
        `/api/accounts/${accountId}/health`,
      ),
    /** サイドバーの警告数用。staff可視範囲の最新riskLevelだけを1回で取る。ログ本文なし。 */
    summary: () =>
      fetchApi<ApiResponse<AccountHealthSummary>>('/api/accounts/health-summary'),
    migrations: () =>
      fetchApi<ApiResponse<AccountMigration[]>>('/api/accounts/migrations'),
    migrate: (fromAccountId: string, data: { toAccountId: string }) =>
      fetchApi<ApiResponse<AccountMigration>>(`/api/accounts/${fromAccountId}/migrate`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getMigration: (migrationId: string) =>
      fetchApi<ApiResponse<AccountMigration>>(`/api/accounts/migrations/${migrationId}`),
  },
/** 広告連携（設計 V2 6-8）。鍵は伏せた形で返ってくる。 */
  /** 緊急停止の影響確認、停止・復旧、追記履歴。 */
  operations: {
    lineReceipts: (accountId: string) => fetchApi<ApiResponse<LineWebhookRecoveryEvent[]>>(`/api/line-webhook-events?status=failed&account_id=${encodeURIComponent(accountId)}`),
    retryLineReceipt: (id: string) => fetchApi<{ success: boolean; status: 'succeeded' | 'needs_review' | 'busy' | 'failed'; reason?: string }>(
      `/api/line-webhook-events/${encodeURIComponent(id)}/retry`, { method: 'POST' },
    ),
    health: (accountId: string) =>
      fetchApi<ApiResponse<OperationHealthSnapshot>>(
        `/api/operations/health?account_id=${encodeURIComponent(accountId)}`,
      ),
    runHealth: (accountId: string) =>
      fetchApi<ApiResponse<OperationHealthSnapshot>>('/api/operations/health/runs', {
        method: 'POST',
        body: JSON.stringify({ lineAccountId: accountId }),
      }),
    alerts: (accountId: string, includeResolved = false) =>
      fetchApi<ApiResponse<OperationAlert[]>>(
        `/api/operations/alerts?account_id=${encodeURIComponent(accountId)}${includeResolved ? '&include_resolved=1' : ''}`,
      ),
    acknowledgeAlert: (id: string, body: { lineAccountId: string; expectedVersion: number; note?: string }) =>
      fetchApi<ApiResponse<OperationAlert> & { duplicate?: boolean }>(`/api/operations/alerts/${encodeURIComponent(id)}/acknowledge`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    retryAlertNotifications: (id: string, lineAccountId: string) =>
      fetchApi<ApiResponse<{ retried: number }>>(`/api/operations/alerts/${encodeURIComponent(id)}/notifications/retry`, {
        method: 'POST', body: JSON.stringify({ lineAccountId }),
      }),
    /* 直前再確認（V-1）。2段階認証がある人は 'totp'、無い人は 'password'。 */
    stepUp: (input: { method: 'totp' | 'password'; value: string }) =>
      fetchApi<ApiResponse<{ token: string; purpose: 'operations.control'; expiresAt: string }>>(
        '/api/auth/step-up',
        { method: 'POST', body: JSON.stringify(
          input.method === 'totp'
            ? { code: input.value, purpose: 'operations.control' }
            : { password: input.value, purpose: 'operations.control' },
        ) },
      ),
    preview: (accountId: string | null) => {
      const query = accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''
      return fetchApi<ApiResponse<{
        control: OperationControl
        counts: Partial<Record<OperationCapability, number>>
        impact: OperationImpactPreview
        permissions: { canControl: boolean }
        calculatedAt: string
      }>>(`/api/operations/control/preview${query}`)
    },
    history: (limit = 100) =>
      fetchApi<ApiResponse<OperationHistoryEntry[]>>(`/api/operations/history?limit=${limit}`),
    sendPaths: (accountId: string | null) => {
      const query = accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''
      return fetchApi<ApiResponse<OperationSendPathsResponse>>(`/api/operations/send-paths${query}`)
    },
    stop: (input: {
      lineAccountId: string | null
      capabilities: OperationCapability[]
      reason: string
      detail?: string | null
      confirmation: '停止'
      expectedVersion: number
    }, stepUpToken: string, idempotencyKey: string) => fetchApi<ApiResponse<{ status: 'changed'; control: OperationControl; incident: OperationIncident }>>(
      '/api/operations/incidents',
      {
        method: 'POST',
        headers: {
          'X-Confirm-Irreversible': 'operation-stop',
          'X-Step-Up-Token': stepUpToken,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(input),
      },
    ),
    restorePreview: (incidentId: string) =>
      fetchApi<ApiResponse<{
        incidentId: string
        status: OperationIncident['status']
        capabilities: OperationCapability[]
        drift: OperationRestoreDrift
      }>>(`/api/operations/incidents/${encodeURIComponent(incidentId)}/restore-preview`, { method: 'POST' }),
    restore: (incidentId: string, input: { confirmation: '復旧'; expectedVersion: number }, stepUpToken: string, idempotencyKey: string) =>
      fetchApi<ApiResponse<{ status: 'restored' | 'partial'; control: OperationControl; incident: OperationIncident; report: OperationRestoreReport | null }>>(
        `/api/operations/incidents/${encodeURIComponent(incidentId)}/restore`,
        {
          method: 'POST',
          headers: {
            'X-Confirm-Irreversible': 'operation-restore',
            'X-Step-Up-Token': stepUpToken,
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(input),
        },
      ),
  },
}
