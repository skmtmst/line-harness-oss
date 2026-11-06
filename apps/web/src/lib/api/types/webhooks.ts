import type { OutgoingWebhook, IncomingWebhook } from '@line-crm/shared'

export type OutgoingWebhookOverview = OutgoingWebhook & {
  deliverySummary: {
    periodDays: number
    total: number
    succeeded: number
    failed: number
    pending: number
    successRate: number | null
    lastResult: {
      status: 'succeeded' | 'failed' | 'pending'
      responseStatus: number | null
      completedAt: string | null
      failureReason: string | null
    } | null
    canRetry: boolean
  }
}

export type IncomingWebhookDetail = IncomingWebhook & {
  version: number
  identityMatching: {
    methods: Array<{
      kind: 'harness_friend_id' | 'external_customer_id' | 'verified_email' | 'verified_phone'
      path: string
    }>
    onNotFound: 'do_nothing' | 'unmatched_box' | 'create_candidate'
  }
  actions: Array<{
    refKind: string
    refId: string
    refVersionId: string | null
    displayName: string
  }>
  actionExecution: {
    // R404: 保存済みの未対応種類があるときは needs_attention と理由が返る。
    state: 'connected' | 'not_configured' | 'needs_attention'
    reason: string | null
  }
  latestSample: {
    receivedAt: string
    fields: Array<{ path: string; type: string; maskedValue: string }>
    truncated: boolean
  } | null
  templateFields: Array<{ path: string; type: string; token: string }>
  /** 人が見つからなかった届物の未確認件数(#939 N-367)。 */
  pendingUnmatched: number
  /** S: 合言葉の入れ替え中だけ、前の合言葉が使える期限。併用期間外は null。 */
  previousSecretUsableUntil: string | null
}

/**
 * 人が見つからなかった届物(#939 N-367)。生の本文は保存していないので、
 * 照合に使った値と形だけの見本だけが返る。
 * S: kind='ambiguous' は同じ値の友だちが2人以上いて保留した届物。
 * candidates に一致した友だちが入る(人がどれか選ぶ)。
 */
export interface IncomingWebhookUnmatchedItem {
  id: string
  kind: 'unmatched' | 'candidate' | 'ambiguous'
  status: 'pending' | 'resolved' | 'dismissed'
  identityAttempts: Array<{ kind: string; path: string; value: string }>
  maskedShape: { fields: Array<{ path: string; type: string; maskedValue: string }>; truncated: boolean } | null
  candidates: Array<{ friendId: string; displayName: string | null }>
  resolvedFriendId: string | null
  resolvedAt: string | null
  receivedAt: string
}

/** S: 受け取りの試しの結果。照合と行動の組み立てまでで、実行はしない。 */
export interface IncomingWebhookTestResult {
  match:
    | { status: 'matched'; friendId: string }
    | { status: 'ambiguous'; friendIds: string[] }
    | { status: 'not_found' }
  identityAttempts: Array<{ kind: string; path: string; value: string }>
  actions: Array<{
    refIndex: number
    refKind: string
    refId: string
    displayName: string
    ok: boolean
    plan?: Array<{ type: string }>
    error?: string
  }>
}

/**
 * 外部システムが公開APIを呼ぶための鍵(#939 N-380)。
 * 管理画面の認証とは別の台帳で、平文は一覧には出ない。
 */
export interface IntegrationApiTokenInfo {
  id: string
  name: string
  tokenPrefix: string
  scopes: string[]
  createdBy: string | null
  lastUsedAt: string | null
  rotatedFromId: string | null
  createdAt: string
  revokedAt: string | null
}

/** 発行・入れ替えの応答にだけ1回だけ平文が乗る。 */
export interface IssuedIntegrationApiToken extends IntegrationApiTokenInfo {
  token: string
}
