import type Database from 'better-sqlite3';

// apps/worker/src/services/unanswered-inbox.ts records the production incident:
// D1 rejects statements over 100 binds, while better-sqlite3 would let tests pass.
export const D1_TEST_BIND_LIMIT = 100;

interface SyncRunnable extends D1PreparedStatement {
  /**
   * batch の中だけで使う同期実行。
   *
   * `run()` は async なので、中で投げても呼び出し側には**拒否された Promise**
   * として返る。await せずに transaction() へ渡すと、better-sqlite3 は
   * 「throw されなかった」と見なして COMMIT してしまい、原子性が壊れる。
   * かといって transaction の中で await すると、書き込みトランザクションを
   * 握ったまま他の接続へ処理が移り、ファイルのDBでは相手が
   * `database is locked` で落ちる（D1 の batch にそんな隙間は無い）。
   * 同期で投げる口を1つ用意して、その両方を避ける。
   */
  __runSync(): { success: true; meta: { changes: number }; results: never[] };
}

export function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): SyncRunnable => ({
      bind: (...next: unknown[]) => {
        if (next.length > D1_TEST_BIND_LIMIT) {
          throw new Error(`D1 bind limit exceeded: ${next.length} > ${D1_TEST_BIND_LIMIT}`);
        }
        return make(next);
      },
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      __runSync() {
        const info = statement.run(...params);
        return { success: true as const, meta: { changes: info.changes }, results: [] };
      },
      raw: async () => [],
    } as unknown as SyncRunnable);
    return make([]);
  }
  return {
    prepare,
    // D1 の batch は原子（一文でも失敗したら全体を巻き戻す）。かつ**1つの塊**
    // として届く。実行の途中で他の接続が割り込む隙間は無い。transaction() に
    // 同期で流すと、その両方が同時に満たせる。
    async batch<T>(statements: D1PreparedStatement[]) {
      const results: unknown[] = [];
      const apply = sqlite.transaction((list: D1PreparedStatement[]) => {
        for (const statement of list) {
          const sync = (statement as SyncRunnable).__runSync;
          if (typeof sync === 'function') {
            results.push(sync.call(statement));
            continue;
          }
          // テストが差し込んだ偽の文。同期に投げられないので、呼び出しだけ
          // ここで行い、結果はトランザクションを閉じてから受け取る。
          results.push(statement.run());
        }
      });
      apply(statements);
      return (await Promise.all(results)) as T;
    },
  } as unknown as D1Database;
}
