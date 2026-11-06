/** 緊急停止の対象、影響、停止状態をサーバーと共有する契約。 */
export type OperationCapability =
  | 'broadcast_dispatch'
  | 'scenario_dispatch'
  | 'reminder_dispatch'
  | 'automation_actions'
  | 'auto_reply_dispatch'
  | 'webhook_outgoing'
  | 'ad_postback'

export type OperationImpactMetric = {
  itemCount: number
  /** 数える経路が無いときは null。**0人と読み替えない。** */
  friendCount: number | null
  pendingCount?: number
  nearestScheduledAt?: string | null
  /** trueのとき、friendCountは代表サンプルだけの合計(下限値)。省略時は全件。 */
  friendCountIsPartial?: boolean
}

export type OperationImpactPreview = Record<
  Extract<OperationCapability,
    | 'broadcast_dispatch'
    | 'scenario_dispatch'
    | 'reminder_dispatch'
    | 'automation_actions'
    | 'auto_reply_dispatch'>,
  OperationImpactMetric
>

export type OperationControl = {
  scopeKey: string
  lineAccountId: string | null
  version: number
  states: Record<OperationCapability, 'running' | 'stopped'>
  activeIncidentId: string | null
  reason: string | null
  actorId: string | null
  stoppedAt: string | null
  updatedAt: string | null
}

export type OperationControlSnapshot = {
  version: number
  states: Record<OperationCapability, 'running' | 'stopped'>
  activeIncidentId: string | null
  reason: string | null
  actorId: string | null
  stoppedAt: string | null
  capturedAt: string
}

export type OperationIncident = {
  id: string
  scopeKey: string
  lineAccountId: string | null
  status: 'preparing' | 'stopped' | 'resolved' | 'failed'
  capabilities: OperationCapability[]
  reason: string
  detail: string | null
  actorId: string
  resolvedByActorId: string | null
  controlVersion: number | null
  beforeSnapshot: OperationControlSnapshot
  stoppedSnapshot: OperationControlSnapshot | null
  restoredSnapshot: OperationControlSnapshot | null
  errorMessage: string | null
  /** N-451: 停止時に記録した定義の指紋（版・期限）。旧incidentはnull。 */
  stoppedDefinitionsJson: string | null
  /** N-451: 直近の復旧試行の検査結果。 */
  restoreReportJson: string | null
  stoppedAt: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

/** N-451: 復旧前検査で見つかった1件のずれ。 */
export type OperationDriftKind = 'changed' | 'deleted' | 'inactive' | 'added' | 'expired'

export type OperationDefinitionDrift = {
  id: string
  kind: OperationDriftKind
  beforeVersion: string | null
  currentVersion: string | null
  currentStatus: string | null
  expiresAt: string | null
}

export type OperationCapabilityDrift = {
  capability: OperationCapability
  unchanged: string[]
  drift: OperationDefinitionDrift[]
  blocked: boolean
}

export type OperationRestoreDrift = {
  accountInactive: boolean
  capabilities: OperationCapabilityDrift[]
  resumable: OperationCapability[]
  expired: { capability: OperationCapability; id: string; expiresAt: string | null }[]
}

export type OperationRestoreReport = {
  evaluatedAt: string
  drift: OperationRestoreDrift
  resumed: OperationCapability[]
  heldExpired: { capability: OperationCapability; id: string; expiresAt: string | null }[]
  remaining: OperationCapability[]
}

export type OperationHealthCheckKey =
  | 'line_connection'
  | 'message_quota'
  | 'external_integrations'
  | 'webhook'
  | 'dispatch_jobs'
  | 'friend_change'
  | 'monitoring_heartbeat'
  | 'infra_canary'
  | 'credential_expiry'

export type OperationHealthResult = {
  id: string
  runId: string
  checkKey: OperationHealthCheckKey
  status: 'normal' | 'warning' | 'danger' | 'unknown'
  summary: string
  value: Record<string, unknown> | null
  threshold: Record<string, unknown> | null
  source: string
  observedAt: string
}

/** LINE受信の工程状態。本文・返信の鍵は含めない。 */
export type LineWebhookRecoveryEvent = {
  webhookEventId: string;
  lineAccountId: string | null;
  eventType: string;
  status: 'received' | 'processing' | 'succeeded' | 'failed';
  receivedAt: string;
  canRetry: boolean;
  recoveryStatus: 'needs_review' | null;
  recoveryLabel: string | null;
  recoveryReasonCode: string | null;
  recoveryReason: string | null;
};

export type OperationHealthSnapshot = {
  loginSecurity?: { configured: boolean; notice: string | null }
  latestRun: {
    id: string
    lineAccountId: string | null
    source: 'scheduled' | 'manual'
    status: 'running' | 'completed' | 'failed'
    overallStatus: 'normal' | 'warning' | 'danger' | 'unknown'
    startedAt: string
    completedAt: string | null
    results: OperationHealthResult[]
  } | null
  overallStatus: 'normal' | 'warning' | 'danger' | 'unknown' | 'stale'
  lastCheckedAt: string | null
  nextCheckAt: string | null
  serverNow: string
}

export type OperationAlert = {
  id: string
  lineAccountId: string
  checkKey: OperationHealthCheckKey
  status: 'open' | 'acknowledged' | 'resolved'
  severity: 'unknown' | 'warning' | 'danger'
  summary: string
  sourceRunId: string
  firstDetectedAt: string
  lastDetectedAt: string
  acknowledgedAt: string | null
  acknowledgedById: string | null
  acknowledgementNote: string | null
  resolvedAt: string | null
  version: number
  reopenedCount: number
  createdAt: string
  updatedAt: string
  notification: { queued: number; sending: number; sent: number; failed: number; unconfigured: number; total: number }
  events: Array<{
    id: string
    action: 'opened' | 'escalated' | 'acknowledged' | 'resolved' | 'reopened'
    severity: 'unknown' | 'warning' | 'danger'
    summary: string
    actorId: string | null
    note: string | null
    alertVersion: number
    createdAt: string
  }>
}

/**
 * 送信経路の台帳1行 (#1050)。GET /api/operations/send-paths の応答。
 * capability=null は緊急停止の対象外と判断した経路（理由は excludedReason）。
 */
export type OperationSendPath = {
  id: string
  label: string
  kind: 'manual' | 'auto' | 'scheduled' | 'proxy' | 'external'
  capability: OperationCapability | null
  state: 'running' | 'stopped' | null
  excludedReason: string | null
  note: string | null
}

export type OperationSendPathsResponse = {
  evaluatedAt: string
  capabilities: OperationCapability[]
  /** 台帳と実装の食い違い。空なら全経路が停止対象か理由付きの対象外。 */
  problems: string[]
  paths: OperationSendPath[]
}

export type OperationHistoryEntry = OperationIncident & {
  historyKind?: 'incident' | 'deployment'
  occurredAt?: string
  deployment?: {
    deploymentId: string
    phase: 'queued' | 'deploying' | 'verifying' | 'succeeded' | 'failed' | 'rolled_back'
    environment: string
    version: string | null
    pullRequest: number | null
    actor: string
    occurredAt: string
  }
}
