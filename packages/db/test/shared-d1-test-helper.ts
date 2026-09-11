import Database from 'better-sqlite3';

/*
 * 独立した接続から同じ D1 を触るためのテスト補助。
 *
 * `d1-test-helper.ts` の asD1 は「1本の :memory: 接続」を D1 の形にかぶせる。
 * 同時公開の競合をそこで作ると、実際には**同じ接続の中で自分と競合している**
 * だけになり、別の worker が同時に叩いた状況の証明にならない（#644 再審査 4）。
 *
 * ここではファイルの SQLite を WAL で開き、接続を2本立てる。2本は別の
 * トランザクションを持ち、UNIQUE・PRIMARY KEY・外部キーは実際に効く。
 *
 * batch は D1 と同じ扱いにする。
 * - 原子（一文でも失敗したら全体を巻き戻す）
 * - **1つの塊として届く**。実行の途中で他の接続が割り込まない。
 * そのため batch の中では await しない（await すると他の接続へ処理が移り、
 * D1 には無い割り込みを作ってしまう）。
 */

interface SyncStatement extends D1PreparedStatement {
  __runSync(): void;
}

export interface SharedD1Options {
  /**
   * 文を流す直前に呼ばれる。**待ち合わせの合図にだけ**使う。
   *
   * 独立した2本の接続でも、better-sqlite3 は同期なので「どの順で交差したか」
   * が実行のたびに変わる。狙った交差（版番号を読んだ直後に相手が公開を
   * 終える 等）を毎回起こすために、こちらの接続だけを一時停止させる。
   * SQL の書き換えも batch の差し替えもしない。
   */
  onStatement?: (sql: string) => Promise<void> | void;
}

export interface SharedD1 {
  db: D1Database;
  raw: Database.Database;
  close(): void;
}

export function openSharedD1(file: string, options: SharedD1Options = {}): SharedD1 {
  const raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  // 相手の塊が終わるまで待つ。D1 も書き込みは直列になる。
  raw.pragma('busy_timeout = 5000');
  raw.pragma('foreign_keys = ON');

  function prepare(query: string): D1PreparedStatement {
    const statement = raw.prepare(query);
    const make = (params: unknown[]): SyncStatement =>
      ({
        bind: (...next: unknown[]) => make(next),
        async all<T>() {
          await options.onStatement?.(query);
          return { results: statement.all(...params) as T[], success: true, meta: {} };
        },
        async first<T>() {
          await options.onStatement?.(query);
          return (statement.get(...params) as T | undefined) ?? null;
        },
        async run<T>() {
          await options.onStatement?.(query);
          const info = statement.run(...params);
          return { success: true, meta: { changes: info.changes }, results: [] } as T;
        },
        __runSync() {
          statement.run(...params);
        },
        raw: async () => [],
      }) as unknown as SyncStatement;
    return make([]);
  }

  const db = {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      const apply = raw.transaction((list: SyncStatement[]) => {
        for (const statement of list) statement.__runSync();
      });
      apply(statements as SyncStatement[]);
      return statements.map(() => ({ success: true, meta: {}, results: [] })) as T;
    },
  } as unknown as D1Database;

  return { db, raw, close: () => raw.close() };
}
