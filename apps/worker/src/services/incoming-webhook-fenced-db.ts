/** Conservatively classify exactly one supported SQLite statement, never a SQL prefix. */
function classifySingleStatement(sql: string): { readOnly: boolean; sql: string } {
  const unsupported = () => { throw new Error('incoming_receipt_unsupported_sql'); };
  if (sql.includes('\0')) unsupported();
  let keyword = '';
  let terminated = false;
  let statementEnd = sql.length;
  for (let i = 0; i < sql.length;) {
    const char = sql[i];
    if (/\s/.test(char)) { i++; continue; }
    if (sql.startsWith('--', i)) {
      i += 2;
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) unsupported();
      i = end + 2;
      continue;
    }
    // D1's all() can execute a SELECT followed by a mutation. No token (including
    // another semicolon) may follow the one optional terminal semicolon.
    if (terminated) unsupported();
    if (!keyword) {
      const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i))?.[0];
      if (!word || !/^(SELECT|INSERT|UPDATE|DELETE|REPLACE)$/i.test(word)) unsupported();
      keyword = word!.toUpperCase();
      i += word!.length;
      continue;
    }
    if (char === ';') { terminated = true; statementEnd = i; i++; continue; }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] !== close) continue;
        if (char !== '[' && sql[i] === close) { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) unsupported();
      continue;
    }
    i++;
  }
  if (!keyword) unsupported();
  // WITH/PRAGMA/EXPLAIN and other unclassified SQL are deliberately unsupported,
  // even when a particular instance could be read-only.
  // D1 treats a comment after a terminal semicolon as an empty second statement.
  // Only strip that terminator/tail after the entire input has passed validation.
  return { readOnly: keyword === 'SELECT', sql: sql.slice(0, statementEnd) };
}

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
        const single = classifySingleStatement(sql);
        return wrap(target.prepare(single.sql), single.readOnly);
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
