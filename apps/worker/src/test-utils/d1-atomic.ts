import type Database from 'better-sqlite3';

// apps/worker/src/services/unanswered-inbox.ts records the production incident:
// D1 rejects statements over 100 binds, while better-sqlite3 would let tests pass.
export const D1_TEST_BIND_LIMIT = 100;

export function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => {
      function runSync<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      }
      return {
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
          return runSync<T>();
        },
        raw: async () => [],
        // batch 用の同期実行口。async run() は失敗を rejected promise に変えるため、
        // better-sqlite3 の transaction が巻き戻しを見逃す。ここでは投げ直す。
        runSyncForBatch: <T>() => runSync<T>(),
      } as unknown as D1PreparedStatement;
    };
    return make([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      const results: unknown[] = [];
      sqlite.transaction(() => {
        for (const statement of statements) {
          const sync = (statement as unknown as { runSyncForBatch?: <T>() => T }).runSyncForBatch;
          results.push(sync ? sync() : statement.run());
        }
      })();
      return Promise.all(results) as T;
    },
  } as unknown as D1Database;
}
