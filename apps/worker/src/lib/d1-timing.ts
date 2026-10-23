export type D1Timing = {
  count: number;
  duration: number;
  pending: number;
  sqlDuration: number;
  sqlCount: number;
  closed: boolean;
};

export function createD1Timing(): D1Timing {
  return { count: 0, duration: 0, pending: 0, sqlDuration: 0, sqlCount: 0, closed: false };
}

const bindingIdentities = new WeakMap<D1Database, D1Database>();

/** 既存のDB別cacheの鍵だけに使う。実際のSQLは計測付きBindingで実行する。 */
export function d1BindingIdentity(db: D1Database): D1Database {
  return bindingIdentities.get(db) ?? db;
}

// first/rawの行データをmetaと誤認しない。メタデータを返すAPIだけから数字を拾う。
function recordSql(timing: D1Timing, value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const meta = (value as { meta?: { duration?: number; timings?: { sql_duration_ms?: number } } }).meta;
  const duration = meta?.timings?.sql_duration_ms ?? meta?.duration;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
    timing.sqlDuration += duration;
    timing.sqlCount += 1;
  }
}

/** Bindingの呼出しを測る。batchは1往復、prepare/bind/withSessionは往復に数えない。 */
export function timedD1(source: D1Database, timing: D1Timing): D1Database {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  async function measure<T>(work: () => Promise<T>, metadata: 'none' | 'result' | 'batch'): Promise<T> {
    if (timing.closed) return work();
    const started = Date.now();
    timing.count += 1;
    timing.pending += 1;
    try {
      const result = await work();
      if (!timing.closed) {
        if (metadata === 'batch' && Array.isArray(result)) result.forEach(value => recordSql(timing, value));
        if (metadata === 'result') recordSql(timing, result);
      }
      return result;
    } finally {
      if (!timing.closed) {
        timing.duration += Math.max(0, Date.now() - started);
        timing.pending -= 1;
      }
    }
  }
  function statement(sourceStatement: D1PreparedStatement): D1PreparedStatement {
    const proxy = new Proxy(sourceStatement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (property === 'bind') return (...args: unknown[]) => statement(value.apply(target, args));
        if (property === 'first' || property === 'raw' || property === 'all' || property === 'run') {
          return (...args: unknown[]) => measure(() => value.apply(target, args),
            property === 'all' || property === 'run' ? 'result' : 'none');
        }
        return value.bind(target);
      },
    });
    originals.set(proxy, sourceStatement);
    return proxy;
  }
  function database<T extends D1Database | D1DatabaseSession>(binding: T): T {
    return new Proxy(binding, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (property === 'prepare') return (sql: string) => statement(value.call(target, sql));
        if (property === 'batch') return (statements: D1PreparedStatement[]) => measure(
          () => value.call(target, statements.map(item => originals.get(item) ?? item)), 'batch');
        if (property === 'exec') return (...args: unknown[]) => measure(() => value.apply(target, args), 'none');
        if (property === 'withSession') return (...args: unknown[]) => database(value.apply(target, args));
        return value.bind(target);
      },
    });
  }
  const wrapped = database(source);
  bindingIdentities.set(wrapped, d1BindingIdentity(source));
  return wrapped;
}
