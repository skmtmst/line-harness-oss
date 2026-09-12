/** All receipt-owned writes share an atomic D1 transaction with their lease fence. */
export function incomingWebhookFencedDb(
  db: D1Database,
  fence: { sourceEventId: string; owner: string; generation: number },
): D1Database {
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const assertLease = () => db.prepare(`SELECT json(CASE WHEN EXISTS (
    SELECT 1 FROM incoming_webhook_receipts
      WHERE source_event_id=? AND lease_owner=? AND attempt_count=? AND status='processing'
        AND lease_expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    ) THEN 'true' ELSE 'incoming_receipt_lease_lost' END) AS incoming_webhook_fence`)
    .bind(fence.sourceEventId, fence.owner, fence.generation);
  const atomic = async (items: D1PreparedStatement[]) => {
    // D1.batch is a SQL transaction. Invalid JSON deliberately raises a D1-compatible
    // SQL error on a lost lease; the entire batch is rolled back, including its writes.
    const results = await db.batch([assertLease(), ...items]);
    return results.slice(1);
  };
  const wrap = (statement: D1PreparedStatement, readOnly: boolean): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (typeof property === 'symbol') return undefined;
        if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values), readOnly);
        if (property === 'run') return async () => (await atomic([target]))[0];
        // The executors use first/all for SELECT only. Mutation RETURNING, PRAGMA,
        // raw, exec and sessions are not supported: fail closed rather than bypass.
        if ((property === 'first' || property === 'all') && readOnly) {
          return target[property].bind(target);
        }
        if (property === 'first' || property === 'all' || property === 'raw') {
          throw new Error(`incoming_receipt_unsupported_statement_api:${property}`);
        }
        return undefined;
      },
    });
    statements.set(wrapped, statement);
    return wrapped;
  };
  return new Proxy(db, {
    get(target, property) {
      if (typeof property === 'symbol') return undefined;
      if (property === 'prepare') return (sql: string) => {
        if (!/^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
          throw new Error('incoming_receipt_unsupported_sql');
        }
        return wrap(target.prepare(sql), /^\s*SELECT\b/i.test(sql));
      };
      if (property === 'batch') return (items: D1PreparedStatement[]) => atomic(items.map(item => {
        const original = statements.get(item);
        if (!original) throw new Error('incoming_receipt_foreign_statement');
        return original;
      }));
      if (property === 'exec' || property === 'withSession' || property === 'dump') {
        throw new Error(`incoming_receipt_unsupported_database_api:${property}`);
      }
      return undefined;
    },
  });
}
