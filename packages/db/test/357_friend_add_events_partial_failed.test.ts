import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

/** schema.sql + 指定ファイルまでの移行を順に適用する。 */
function setupDbThrough(maxFile: string): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => f <= maxFile);
  for (const file of migrationFiles) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

describe('357 friend_add_events partial_failed', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDbThrough('343_messages_log_broadcast_recipient_index.sql');
    db.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1')`,
    ).run();
    db.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id)
       VALUES ('friend-1', 'U-1', 'account-1')`,
    ).run();
    db.prepare(
      `INSERT INTO friend_add_events
        (id, line_account_id, friend_id, webhook_event_id, friend_kind, routing_status, occurred_at)
       VALUES ('event-old', 'account-1', 'friend-1', 'webhook-old', 'first_time', 'completed', '2026-09-01T10:00:00.000+09:00')`,
    ).run();
    db.prepare(
      `INSERT INTO friend_add_action_runs
        (id, event_id, action_stable_id, idempotency_key, status)
       VALUES ('action-old', 'event-old', 'action-1', 'event-old:action-1', 'completed')`,
    ).run();
    execSafe(
      db,
      readFileSync(join(MIGRATIONS_DIR, '357_friend_add_events_partial_failed.sql'), 'utf8'),
    );
  });

  afterEach(() => db.close());

  it('既存の行と列を保ったまま作り直す', () => {
    expect(columns(db, 'friend_add_events')).toEqual([
      'id', 'line_account_id', 'friend_id', 'webhook_event_id', 'friend_kind',
      'is_unblocked_hint', 'attribution_status', 'ref_code', 'entry_route_id',
      'candidate_id', 'routing_rule_id', 'routing_status', 'occurred_at', 'processed_at',
      'created_at', 'winning_rule_version_id', 'error_code', 'scenario_enrollment_id',
      'delivery_count', 'first_delivery_sent_at',
    ]);
    expect(
      db.prepare(`SELECT routing_status FROM friend_add_events WHERE id = 'event-old'`).get(),
    ).toEqual({ routing_status: 'completed' });
  });

  it('partial_failed を受け付け、未知の状態は拒否する', () => {
    db.prepare(
      `INSERT INTO friend_add_events
        (id, line_account_id, friend_id, webhook_event_id, friend_kind, routing_status, occurred_at)
       VALUES ('event-partial', 'account-1', 'friend-1', 'webhook-partial', 'first_time', 'partial_failed', '2026-09-08T10:00:00.000+09:00')`,
    ).run();
    expect(() =>
      db.prepare(
        `INSERT INTO friend_add_events
          (id, line_account_id, friend_id, webhook_event_id, friend_kind, routing_status, occurred_at)
         VALUES ('event-bogus', 'account-1', 'friend-1', 'webhook-bogus', 'first_time', 'bogus', '2026-09-08T10:00:00.000+09:00')`,
      ).run(),
    ).toThrow();
  });

  it('子表の行と外部キーを保ったまま付け替える', () => {
    expect(
      db.prepare(`SELECT status FROM friend_add_action_runs WHERE id = 'action-old'`).get(),
    ).toEqual({ status: 'completed' });
    const refs = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'friend_add_action_runs'`,
    ).get() as { sql: string };
    expect(refs.sql).toContain('REFERENCES "friend_add_events"(id)');
  });

  it('webhookイベント単位の一意制約と索引を保つ', () => {
    expect(() =>
      db.prepare(
        `INSERT INTO friend_add_events
          (id, line_account_id, friend_id, webhook_event_id, friend_kind, routing_status, occurred_at)
         VALUES ('event-dup', 'account-1', 'friend-1', 'webhook-old', 'first_time', 'pending', '2026-09-08T10:00:00.000+09:00')`,
      ).run(),
    ).toThrow();
    const indexes = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'friend_add_events' ORDER BY name`,
    ).all() as Array<{ name: string }>).map((row) => row.name);
    expect(indexes).toEqual([
      'idx_friend_add_events_v357_account_state',
      'idx_friend_add_events_v357_account_time',
      'idx_friend_add_events_v357_friend',
      'idx_friend_add_events_v357_rule_time',
      'sqlite_autoindex_friend_add_events_1',
      'sqlite_autoindex_friend_add_events_2',
    ]);
    const childIndexes = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'friend_add_action_runs' ORDER BY name`,
    ).all() as Array<{ name: string }>).map((row) => row.name);
    expect(childIndexes).toEqual([
      'idx_friend_add_action_runs_v357_event_status',
      'idx_friend_add_action_runs_v357_retry',
      'sqlite_autoindex_friend_add_action_runs_1',
      'sqlite_autoindex_friend_add_action_runs_2',
      'sqlite_autoindex_friend_add_action_runs_3',
    ]);
  });
});
