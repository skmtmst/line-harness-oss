/** 7機能の実行記録画面で共通に使う所有元。書込台帳は機能ごとに安全に保つ。 */
export type ExecutionOwnerKind =
  | "broadcast"
  | "reminder"
  | "scenario"
  | "auto_reply"
  | "manual"
  | "user"
  | "automation"
  | "notification"
  | "integration";

export type ExecutionRunStatus =
  | "succeeded"
  | "failed"
  | "partial"
  | "skipped"
  | "pending"
  | "cancelled"
  | "claimed"
  | "permanent_failed";

export interface ExecutionRunIdentity {
  ownerKind: ExecutionOwnerKind;
  ownerId: string;
  lineAccountId: string | null;
}

/** 7機能の実行記録一覧が共通で読む9項目。 */
export interface ExecutionRunListItem extends ExecutionRunIdentity {
  occurredAt: string;
  subject: string | null;
  accountLabel: string | null;
  triggerLabel: string;
  reference: string | null;
  status: ExecutionRunStatus;
  detail: string | null;
  durationMs: number | null;
  canRetry: boolean;
}
