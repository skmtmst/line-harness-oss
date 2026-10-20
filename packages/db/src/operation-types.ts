
export const OPERATION_CAPABILITIES = [
  'broadcast_dispatch',
  'scenario_dispatch',
  'reminder_dispatch',
  'automation_actions',
  'auto_reply_dispatch',
  'webhook_outgoing',
  'ad_postback',
] as const;


export type OperationCapability = (typeof OPERATION_CAPABILITIES)[number];

export type OperationState = 'running' | 'stopped';

export type OperationStates = Record<OperationCapability, OperationState>;

export type OperationIncidentStatus = 'preparing' | 'stopped' | 'resolved' | 'failed';


export interface OperationControlSnapshot {
  version: number;
  states: OperationStates;
  activeIncidentId: string | null;
  reason: string | null;
  actorId: string | null;
  stoppedAt: string | null;
  capturedAt: string;
}


export interface OperationIncident {
  id: string;
  scopeKey: string;
  lineAccountId: string | null;
  status: OperationIncidentStatus;
  capabilities: OperationCapability[];
  reason: string;
  detail: string | null;
  actorId: string;
  resolvedByActorId: string | null;
  controlVersion: number | null;
  beforeSnapshot: OperationControlSnapshot;
  stoppedSnapshot: OperationControlSnapshot | null;
  restoredSnapshot: OperationControlSnapshot | null;
  errorMessage: string | null;
  /**
   * N-451: 停止した瞬間に稼働対象だった定義の指紋（版・期限）のJSON。
   * この仕組みより前に止めた incident では null で、復旧前検査は
   * 「記録なし」として全ての変更検査をスキップしない（検査自体は走る）。
   */
  stoppedDefinitionsJson: string | null;
  /** N-451: 直近の復旧試行の検査結果（再開した対象・理由つきで止めた対象）。 */
  restoreReportJson: string | null;
  stoppedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
