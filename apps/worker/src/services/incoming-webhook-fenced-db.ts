/** SQL の接頭辞だけで判断せず、対応する SQLite の1文全体を安全側で分類する。 */
export function classifySingleStatement(
  sql: string,
  options: { withAsMutation?: boolean } = {},
): { readOnly: boolean; sql: string } {
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
      // SQLite の -- コメント終端は LF または EOF であり CR ではない。CR を区切りと扱うと、無視される引用符やセミコロンを実行 SQL と誤解する。
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) unsupported();
      i = end + 2;
      continue;
    }
    // D1 の all も SELECT 後の更新を実行できるため、末尾の任意のセミコロン以降はほかのトークンを許さない。
    if (terminated) unsupported();
    if (!keyword) {
      const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i))?.[0];
      // 工程記録の DB だけは WITH を書き込みとして扱う（必ず柵つきの一括で実行し、first/all は拒否）。
      const allowed = options.withAsMutation ? /^(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)$/i : /^(SELECT|INSERT|UPDATE|DELETE|REPLACE)$/i;
      if (!word || !allowed.test(word)) unsupported();
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
  // WITH/PRAGMA/EXPLAIN など未分類の SQL は読取可能でも拒む。末尾コメントを空の2文目とする D1 のため、入力全体を検証した後だけ終端を除く。
  return { readOnly: keyword === 'SELECT', sql: sql.slice(0, statementEnd) };
}

/** 受領票のすべての書込を、実行権の照合と同じ原子的 D1 トランザクションへ含める。 */
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
    // 実行権を失った場合は不正 JSON で SQL を失敗させ、D1 batch のすべての書込を巻き戻す。
    const results = await db.batch([assertLease(), ...items]);
    return results.slice(1);
  };
  const wrap = (statement: D1PreparedStatement, readOnly: boolean): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (typeof property === 'symbol') return undefined;
        if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values), readOnly);
        if (property === 'run') return async () => (await atomic([target]))[0];
        // first/all は SELECT だけに限り、更新 RETURNING・PRAGMA・raw・exec・sessions は検査を迂回させず拒む。
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
