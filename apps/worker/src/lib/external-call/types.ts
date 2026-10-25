/** 診断には URL・資格情報・要求本文・外部のエラー本文を含めない。 */
export type FailureReason = 'http' | 'timeout' | 'network' | 'cancelled' | 'invalid_response' | 'guard' | 'storage' | 'budget';
export type Outcome<T> =
  | { kind: 'success'; value: T }
  | { kind: 'transient' | 'permanent' | 'unknown'; reason: FailureReason; status?: number; retryAt?: number };

export interface CallScope {
  accountId: string;
  storeId: string;
  /** クエリやトークンを含む URL でなく、事業者と接続先の固定グループで識別する。 */
  destination: string;
  /** 秘密値そのものでなく、接続を示す固定の識別子を使う。 */
  connectionId: string;
}
export type WaitPolicy =
  | { kind: 'fixed'; delaysMs: readonly number[] }
  | { kind: 'exponential'; baseMs: number; capMs: number; jitterRatio: number };
export interface CallPolicy {
  category: 'api' | 'outgoing_webhook';
  /** 初回を含む上限とし、契約の4回・8回を増やさない。 */
  maxAttempts: number;
  timeoutMs: number;
  deadlineAt: number;
  wait: WaitPolicy;
}
export interface CallIdentity {
  scope: CallScope;
  operationId: string;
  idempotencyKey: string;
  /** 保存済みで不変の対象・本文・送信元のスナップショットを識別する。 */
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
/** 同じ範囲・識別・不変の方針を照合し、操作と版の CAS で2つの書込を永続的・原子的に確定する。送信開始済みは期限後も再取得せず照合する。false や例外なら送らず、SDK 内でも台帳の外で再試行しない。 */
export interface CallJournal {
  compareAndSwap(previous: Readonly<CallState>, next: Readonly<CallState>): Promise<boolean>;
}
export interface CircuitLease { scopeKey: string; generation: number; probe: boolean }
export type CircuitAdmission = { allowed: true; lease: CircuitLease } | { allowed: false; nextAt: number };
/** 必要な実行範囲全体で原子性を保つ。isolate 間では共有実装を注入する。 */
export interface CircuitStore {
  acquire(scope: CallScope, now: number): Promise<CircuitAdmission>;
  settle(lease: CircuitLease, result: 'success' | 'failure' | 'neutral', now: number, retryAt?: number): Promise<void>;
}
export interface CallRequest<T> {
  state: Readonly<CallState>;
  journal: CallJournal;
  /** 送信直前に権限・統括・同意・上限・停止・版・送信時間帯を再確認する。 */
  authorize(): Promise<boolean>;
  /** 応答本文の読取と解釈を含め、物理要求は1回だけにする。 */
  execute(signal: AbortSignal, identity: Readonly<CallIdentity>): Promise<Outcome<T>>;
  signal?: AbortSignal;
}
export type CallResult<T> =
  | { kind: 'success'; state: CallState; value: T }
  | { kind: 'deferred'; state: CallState; reason: 'schedule' | 'circuit'; nextAt: number }
  | { kind: 'succeeded' | 'unknown' | 'stopped' | 'conflict' | 'storage_error'; state: CallState };
