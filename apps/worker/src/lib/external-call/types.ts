/** No URLs, credentials, request bodies or provider error text belong in diagnostics. */
export type FailureReason = 'http' | 'timeout' | 'network' | 'cancelled' | 'invalid_response' | 'guard' | 'storage' | 'budget';
export type Outcome<T> =
  | { kind: 'success'; value: T }
  | { kind: 'transient' | 'permanent' | 'unknown'; reason: FailureReason; status?: number; retryAt?: number };

export interface CallScope {
  accountId: string;
  storeId: string;
  /** Stable provider/endpoint group, never a URL with a query or a token. */
  destination: string;
  /** Stable connection identity; never the credential itself. */
  connectionId: string;
}
export type WaitPolicy =
  | { kind: 'fixed'; delaysMs: readonly number[] }
  | { kind: 'exponential'; baseMs: number; capMs: number; jitterRatio: number };
export interface CallPolicy {
  category: 'api' | 'outgoing_webhook';
  /** Includes the first call. May only reduce the contract's 4 / 8 limit. */
  maxAttempts: number;
  timeoutMs: number;
  deadlineAt: number;
  wait: WaitPolicy;
}
export interface CallIdentity {
  scope: CallScope;
  operationId: string;
  idempotencyKey: string;
  /** Identity of the immutable persisted target/body/sender snapshot. */
  snapshotId: string;
  effect: 'read' | 'write';
}
export interface CallState {
  /** 作成時の依頼を、保存済み台帳からcron再開後まで結ぶ（旧台帳は未指定）。 */
  requestId?: string;
  identity: CallIdentity;
  policy: CallPolicy;
  createdAt: number;
  revision: number;
  attempts: number;
  phase: 'ready' | 'started' | 'succeeded' | 'unknown' | 'stopped';
  nextAt: number;
  reason?: FailureReason;
  status?: number;
}
/**
 * Both writes MUST be durable, atomic compare-and-swap on operation + revision,
 * verifying the SAME scope, identity and immutable policy. A started record is
 * never reclaimed for sending (even after lease expiry); reconcile it instead.
 * False/throw means do not send. No SDK / adapter may retry behind this journal.
 */
export interface CallJournal {
  compareAndSwap(previous: Readonly<CallState>, next: Readonly<CallState>): Promise<boolean>;
}
export interface CircuitLease { scopeKey: string; generation: number; probe: boolean }
export type CircuitAdmission = { allowed: true; lease: CircuitLease } | { allowed: false; nextAt: number };
/** Atomic across the intended execution domain. Inject a shared implementation across isolates. */
export interface CircuitStore {
  acquire(scope: CallScope, now: number): Promise<CircuitAdmission>;
  settle(lease: CircuitLease, result: 'success' | 'failure' | 'neutral', now: number, retryAt?: number): Promise<void>;
}
export interface CallRequest<T> {
  state: Readonly<CallState>;
  journal: CallJournal;
  /** Recheck live permissions, tenant, consent, limits, switches, version and quiet hours. */
  authorize(): Promise<boolean>;
  /** Exactly ONE physical request, including reading/interpreting its body. */
  execute(signal: AbortSignal, identity: Readonly<CallIdentity>): Promise<Outcome<T>>;
  signal?: AbortSignal;
}
export type CallResult<T> =
  | { kind: 'success'; state: CallState; value: T }
  | { kind: 'deferred'; state: CallState; reason: 'schedule' | 'circuit'; nextAt: number }
  | { kind: 'succeeded' | 'unknown' | 'stopped' | 'conflict' | 'storage_error'; state: CallState };
