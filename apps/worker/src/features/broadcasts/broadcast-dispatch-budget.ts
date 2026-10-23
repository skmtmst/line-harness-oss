export interface BroadcastDispatchOptions {
  accountId?: string | null;
  credentialEncryptionKey?: string;
  maxRunMs?: number;
  maxSqlStatements?: number;
  maxRecipients?: number;
  maxLineCalls?: number;
  now?: () => number;
}

export interface BroadcastDispatchResult {
  broadcasts: number;
  recipients: number;
  acceptedRecipients: number;
  /** 途中まで成功していても送信失敗後は即時継続せず、次の定期処理で再確認する。 */
  retryDeferred: boolean;
  lineRequests: number;
  sqlStatements: number;
  /** 停止条件により今は動かせない配信も含む。再投入は待機時間を設ける。 */
  hasMore: boolean;
  /** 残件なし=null、今送れる候補あり=0、時間分散の最短待機=正の秒数。 */
  nextDelaySeconds: number | null;
}

const bounded = (value: number | undefined, fallback: number, cap: number) =>
  Number.isFinite(value) ? Math.max(1, Math.min(cap, Math.floor(value!))) : fallback;

/** 送信前に記録用の余裕を確保する。受理後の書き込みを予算で中断しない。 */
export class BroadcastDispatchBudget {
  readonly result: BroadcastDispatchResult = { broadcasts: 0, recipients: 0, acceptedRecipients: 0, retryDeferred: false, lineRequests: 0, sqlStatements: 0, hasMore: false, nextDelaySeconds: null };
  readonly pageSize: number;
  private readonly clock: () => number;
  private readonly deadline: number;
  private readonly maxSql: number;
  private readonly maxRecipients: number;
  private readonly maxCalls: number;
  constructor(options: BroadcastDispatchOptions = {}) {
    this.clock = options.now ?? Date.now;
    this.deadline = this.clock() + bounded(options.maxRunMs, 15_000, 30_000);
    this.maxSql = bounded(options.maxSqlStatements, 800, 850);
    this.maxRecipients = bounded(options.maxRecipients, 150, 500);
    this.maxCalls = bounded(options.maxLineCalls, 150, 200);
    this.pageSize = Math.min(150, this.maxRecipients);
  }
  canStart(sqlReserve = 100, recipients = 0, calls = 0): boolean {
    return this.clock() < this.deadline && this.result.sqlStatements + sqlReserve <= this.maxSql
      && this.result.recipients + recipients <= this.maxRecipients && this.result.lineRequests + calls <= this.maxCalls;
  }
  nowMs(): number { return this.clock(); }
  dispatch(recipients: number): void {
    this.result.recipients += recipients;
    this.result.lineRequests += 1;
  }
  accept(recipients: number): void { this.result.acceptedRecipients += recipients; }
  deferRetry(): void { this.result.retryDeferred = true; }
  /** 宛先・通数から送信権/ログ/決着の最大文数を見積もる。後処理は別の回収処理が担う。 */
  batchSize(messageParts: number, personalized: boolean): number {
    const sqlPerRecipient = messageParts + (personalized ? 8 : 2);
    return Math.max(0, Math.min(this.pageSize, this.maxRecipients - this.result.recipients,
      personalized ? this.maxCalls - this.result.lineRequests : this.maxCalls > this.result.lineRequests ? this.pageSize : 0,
      Math.floor((this.maxSql - this.result.sqlStatements - 100) / sqlPerRecipient)));
  }
  database(source: D1Database): D1Database {
    const originals = new WeakMap<object, D1PreparedStatement>();
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
      const proxy = new Proxy(statement, { get: (target, key) => {
        if (key === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
        if (['first', 'all', 'run', 'raw'].includes(String(key))) return (...args: unknown[]) => {
          this.result.sqlStatements++;
          return Reflect.apply(Reflect.get(target, key), target, args);
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      originals.set(proxy, statement);
      return proxy;
    };
    return new Proxy(source, { get: (target, key) => {
      if (key === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (key === 'batch') return (statements: D1PreparedStatement[]) => {
        this.result.sqlStatements += statements.length;
        return target.batch(statements.map(statement => originals.get(statement) ?? statement));
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
}
