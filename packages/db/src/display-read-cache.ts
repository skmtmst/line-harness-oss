/**
 * A display calculation owns this cache, never a D1 binding or an authenticated
 * user across requests. Do not pass the wrapped DB to authorization, audience
 * selection, payment or reservation confirmation. Cross-request caching needs a
 * durable revision changed atomically by every writer; a process-local counter
 * cannot provide that guarantee on Workers.
 */
const TTL_MS = 1_000;
const MAX_ENTRIES = 128;
const MAX_BYTES = 1_048_576;
type Entry = { pending: Promise<unknown>; expiresAt: number; bytes: number };

export function createDisplayReadCache(source: D1Database, now = Date.now) {
  const entries = new Map<string, Entry>();
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  let generation = 0;
  let bytes = 0;
  let writes = 0;
  let disposed = false;
  const invalidate = () => { generation++; entries.clear(); bytes = 0; };
  const remove = (key: string, entry: Entry) => {
    if (entries.get(key) === entry) { entries.delete(key); bytes -= entry.bytes; }
  };
  const mutate = async <T>(work: () => Promise<T>): Promise<T> => {
    writes++;
    invalidate();
    try { return await work(); }
    finally { writes--; invalidate(); }
  };
  const read = async (key: string, work: () => Promise<unknown>): Promise<unknown> => {
    if (disposed || writes) return work();
    const at = now();
    for (const [k, entry] of entries) if (entry.expiresAt <= at) remove(k, entry);
    const hit = entries.get(key);
    if (hit) return structuredClone(await hit.pending);
    if (entries.size >= MAX_ENTRIES) return work();
    const startedGeneration = generation;
    const entry: Entry = { pending: Promise.resolve(), expiresAt: at + TTL_MS, bytes: 0 };
    entry.pending = Promise.resolve().then(work).then(value => {
      // Do not retain errors, missing values, failed D1 results or late reads.
      if (disposed || generation !== startedGeneration || now() >= entry.expiresAt
        || value == null || (typeof value === 'object' && 'success' in value && value.success === false)) {
        remove(key, entry);
        return value;
      }
      const saved = structuredClone(value);
      const size = new TextEncoder().encode(JSON.stringify(saved)).byteLength;
      if (bytes + size > MAX_BYTES) remove(key, entry);
      else { entry.bytes = size; bytes += size; }
      return saved;
    }, error => { remove(key, entry); throw error; });
    entries.set(key, entry);
    return structuredClone(await entry.pending);
  };
  const parameterKey = (value: unknown): unknown => {
    if (value instanceof ArrayBuffer) return ['bytes', ...new Uint8Array(value)];
    if (ArrayBuffer.isView(value)) return ['bytes', ...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
    return [typeof value, value];
  };
  const statement = (sql: string, original: D1PreparedStatement, params: unknown[]): D1PreparedStatement => {
    // Only ordinary SELECT reads. CTEs, PRAGMAs, run, and raw go directly to
    // D1. No SQL rewriting: binds, column selection and result form stay exact.
    const selectable = /^\s*SELECT\b/i.test(sql) && !/;\s*\S/.test(sql);
    const wrapped = new Proxy(original, {
      get(target, name) {
        if (name === 'bind') return (...values: unknown[]) => statement(sql, target.bind(...values), values);
        if (name === 'first' || name === 'all') return (...args: unknown[]) => {
          const work = () => Reflect.apply(target[name], target, args) as Promise<unknown>;
          if (!selectable) return mutate(work);
          return read(JSON.stringify([sql, params.map(parameterKey), name, args]), work);
        };
        if (name === 'run' || name === 'raw') return (...args: unknown[]) =>
          mutate(() => Reflect.apply(target[name], target, args) as Promise<unknown>);
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    statements.set(wrapped, original);
    return wrapped;
  };
  const db = new Proxy(source, {
    get(target, name) {
      if (name === 'prepare') return (sql: string) => statement(sql, target.prepare(sql), []);
      if (name === 'batch') return (items: D1PreparedStatement[]) =>
        mutate(() => target.batch(items.map(item => statements.get(item) ?? item)));
      if (name === 'exec') return (sql: string) => mutate(() => target.exec(sql));
      // A session is deliberately live; it does not inherit display memoization.
      const value: unknown = Reflect.get(target, name, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db, invalidate, dispose: () => { disposed = true; invalidate(); } };
}

/** Fresh scope per top-level calculation. Always discard it, including on error. */
export async function withDisplayReadCache<T>(db: D1Database, calculate: (displayDb: D1Database) => Promise<T>): Promise<T> {
  const cache = createDisplayReadCache(db);
  try { return await calculate(cache.db); }
  finally { cache.dispose(); }
}
