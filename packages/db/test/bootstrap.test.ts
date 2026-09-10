import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const GENERATOR = join(PKG_ROOT, 'scripts', 'generate-bootstrap.mjs');
const BOOTSTRAP_PATH = join(PKG_ROOT, 'bootstrap.sql');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN_SQLITE_ERROR = /duplicate column name|already exists/i;

/*
 * 309→329本まで伸びた migration を1文ずつ同期実行し続けると、vitest worker
 * のRPC心拍(onTaskUpdate)を1秒以上返せず、心拍タイムアウトで異常終了する
 * (#698、試験は1件も落ちていないのに `[vitest-worker]: Timeout calling
 * "onTaskUpdate"` で落ちる)。db.exec自体は同期APIで分割できないため、
 * 一定件数ごとにsetImmediateへ制御を返し、心拍を通す隙間を作る。
 */
const YIELD_EVERY_N_STATEMENTS = 50;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigrationReplay(db: Database.Database): Promise<void> {
  db.exec(readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let statementsSinceYield = 0;
  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of splitSqlStatements(sql)) {
      try {
        db.exec(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!BENIGN_SQLITE_ERROR.test(message)) {
          throw new Error(`${file}: ${message}`);
        }
      }
      statementsSinceYield += 1;
      if (statementsSinceYield >= YIELD_EVERY_N_STATEMENTS) {
        statementsSinceYield = 0;
        await yieldToEventLoop();
      }
    }
  }
}

function readSchemaObjects(db: Database.Database) {
  return db
    .prepare(
      `
        SELECT type, name, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL
          AND name NOT LIKE 'sqlite_%'
          -- _migrations は配備script が持つ適用記録で、アプリのスキーマでは
          -- ない。generate-bootstrap.mjs 側でも同じ理由で外している。
          AND name <> '_migrations'
        ORDER BY
          CASE type
            WHEN 'table' THEN 0
            WHEN 'index' THEN 1
            WHEN 'trigger' THEN 2
            WHEN 'view' THEN 3
            ELSE 4
          END,
          name
      `,
    )
    .all() as Array<{ type: string; name: string; sql: string }>;
}

describe('bootstrap.sql', () => {
  it(
    /*
     * 子プロセスを execFileSync で同期起動すると、node起動+329本の
     * migration読み込みが終わるまでworkerスレッドが完全に止まり、
     * 同じ理由でRPC心拍タイムアウトを踏む(#698)。execFile を
     * promisify して await するだけで、子プロセス待ちの間もイベント
     * ループが空くため、検査の強さ(非0終了で失敗)は変えずに直る。
     */
    'stays in sync with schema.sql + migrations',
    async () => {
      await expect(execFileAsync('node', [GENERATOR, '--check'], { cwd: PKG_ROOT })).resolves.toBeTruthy();
    },
    60_000,
  );

  it(
    'matches the schema produced by replaying all migrations',
    async () => {
      const bootstrapDb = new Database(':memory:');
      const replayDb = new Database(':memory:');

      bootstrapDb.exec(readFileSync(BOOTSTRAP_PATH, 'utf8'));
      await applyMigrationReplay(replayDb);

      expect(readSchemaObjects(bootstrapDb)).toEqual(readSchemaObjects(replayDb));
    },
    60_000,
  );
});
