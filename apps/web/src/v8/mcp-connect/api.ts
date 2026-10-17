/*
 * G9 AI とつなぐ（MCP）の管理画面の口（要件 G9 §3）。
 * Worker の口は Codex が作る途中のため、画面側にだけ置く（lib/api* は Codex の持ち物）。Worker ができたら lib へ移す。
 */
import { fetchApi, type StepUpPurpose } from '@/lib/api'

type Result<T> = { success: true; data: T }
const e = encodeURIComponent
const json = (method: string, body: unknown, stepUpToken?: string) => ({ method, body: JSON.stringify(body), ...(stepUpToken ? { headers: { 'X-Step-Up-Token': stepUpToken } } : {}) })

/** できることの 3 段（要件 §2-2）。作った後は変えられない。 */
export type McpLevel = 'read' | 'draft' | 'send_request'
export type McpStatus = 'active' | 'stopped' | 'expired'

export interface McpConnection {
  id: string
  name: string
  level: McpLevel
  accounts: Array<{ id: string; name: string }>
  keyPrefix: string
  expiresAt: string
  lastUsedAt: string | null
  status: McpStatus
  /** 鍵の作り直し中：古い鍵が使える最後の時刻。作り直していなければ null。 */
  previousKeyExpiresAt: string | null
  version: number
}

/** 作った直後・作り直した直後だけ返る（鍵は 1 回だけ）。 */
export interface McpIssued { connection: McpConnection; url: string; key: string }

export type McpCallResult = 'ok' | 'refused' | 'error' | 'rate_limited'
export type McpCallKind = 'read' | 'draft' | 'send_request'
export interface McpCallLog {
  id: string
  at: string
  connectionId: string
  connectionName: string
  kind: McpCallKind
  result: McpCallResult
  /** 断った理由など（個人情報なし）。 */
  summary: string
  targetType: 'broadcast' | 'friends' | 'tags' | 'bookings' | 'analytics' | null
  targetId: string | null
}
export interface McpLogPage { items: McpCallLog[]; total: number; connection: McpConnection | null }

/** 本人確認の目的。lib/api の StepUpPurpose に Codex が足すまで、画面側で名前だけ決める。 */
export const MCP_STEP_UP = 'mcp.connection' as StepUpPurpose

export const mcpApi = {
  list: (accountId: string) => fetchApi<Result<McpConnection[]>>(`/api/mcp-connections?account_id=${e(accountId)}`),
  create: (input: { name: string; level: McpLevel; accountIds: string[]; expiresInDays: number }, stepUpToken?: string) =>
    fetchApi<Result<McpIssued>>('/api/mcp-connections', json('POST', input, stepUpToken)),
  stop: (id: string, expectedVersion: number, reason?: string) => fetchApi<Result<McpConnection>>(`/api/mcp-connections/${e(id)}/stop`, json('POST', { expectedVersion, ...(reason ? { reason } : {}) })),
  rotate: (id: string, expectedVersion: number, stepUpToken?: string) => fetchApi<Result<McpIssued>>(`/api/mcp-connections/${e(id)}/rotate`, json('POST', { expectedVersion }, stepUpToken)),
  logs: (query: { connectionId?: string; result?: string; kind?: string; days: number; page: number; limit: number }) => {
    const q = new URLSearchParams({ days: String(query.days), page: String(query.page), limit: String(query.limit) })
    if (query.connectionId) q.set('connectionId', query.connectionId)
    if (query.result) q.set('result', query.result)
    if (query.kind) q.set('kind', query.kind)
    return fetchApi<Result<McpLogPage>>(`/api/mcp-connections/logs?${q}`)
  },
}
