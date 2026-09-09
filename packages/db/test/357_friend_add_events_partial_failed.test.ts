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

/*
 * 移行の再生は全部同期で走るので、テストごとに繰り返すとその間ワーカーが
 * 止まる。1度だけ組み立てて中身を控え、以後はその写しから起こす。
 * 写しは独立したDBなので、テスト同士は影響し合わない。
 */
const migratedSnapshots = new Map<string, Buffer>();

/** schema.sql + 指定ファイルまでの移行を順に適用する。 */
function setupDbThrough(maxFile: string): Database.Database {
  const cached = migratedSnapshots.get(maxFile);
  if (cached) return new Database(cached);
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => f <= maxFile);
  for (const file of migrationFiles) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  migratedSnapshots.set(maxFile, db.serialize());
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
        (id, line_account_id, friend_id, webhook_event_id, friend_kind, routing_status, occurred_at, delivery_count)
       VALUES ('event-old', 'account-1', 'friend-1', 'webhook-old', 'first_time', 'completed', '2026-09-01T10:00:00.000+09:00', 1)`,
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

  /*
   * 旧データの移し替えは「送っていないと言い切れる行」だけを動かす。
   * delivery_count / first_delivery_sent_at は migration 308 で足した列なので、
   * それ以前に作られた行は**送っていても 0 / NULL**。動かすと既に案内が
   * 届いている人へ2通目が届く。
   */
  describe('旧データの移し替え', () => {
    const APPLIED_308 = '2026-09-05 01:00:00'; // UTC。JSTでは 2026-09-05T10:00:00
    const migration357 = () =>
      readFileSync(join(MIGRATIONS_DIR, '357_friend_add_events_partial_failed.sql'), 'utf8');

    function freshDb(options?: { record308?: boolean }): Database.Database {
      const fresh = setupDbThrough('343_messages_log_broadcast_recipient_index.sql');
      fresh.prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
         VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1')`,
      ).run();
      fresh.prepare(
        `INSERT INTO friends (id, line_user_id, line_account_id)
         VALUES ('friend-1', 'U-1', 'account-1')`,
      ).run();
      if (options?.record308 !== false) {
        fresh.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
        fresh.prepare(`INSERT INTO _migrations (name, applied_at) VALUES (?, ?)`)
          .run('308_friend_add_rule_data_contract.sql', APPLIED_308);
      }
      return fresh;
    }

    function seedEvent(
      target: Database.Database,
      row: {
        id: string; createdAt: string; deliveryCount?: number;
        firstDeliverySentAt?: string | null; errorCode?: string | null;
        status?: string;
      },
    ): void {
      target.prepare(
        `INSERT INTO friend_add_events
          (id, line_account_id, friend_id, webhook_event_id, friend_kind, routing_status,
           occurred_at, created_at, delivery_count, first_delivery_sent_at, error_code)
         VALUES (?, 'account-1', 'friend-1', ?, 'first_time', ?, '2026-09-01T10:00:00.000+09:00', ?, ?, ?, ?)`,
      ).run(
        row.id, `webhook-${row.id}`, row.status ?? 'completed', row.createdAt,
        row.deliveryCount ?? 0, row.firstDeliverySentAt ?? null, row.errorCode ?? null,
      );
    }

    function statusOf(target: Database.Database, id: string): { routing_status: string; error_code: string | null } {
      return target.prepare(
        `SELECT routing_status, error_code FROM friend_add_events WHERE id = ?`,
      ).get(id) as { routing_status: string; error_code: string | null };
    }

    it('308適用後に作られた未送信の行だけ partial_failed へ移す', () => {
      const target = freshDb();
      try {
        seedEvent(target, { id: 'event-unsent', createdAt: '2026-09-06T10:00:00.000' });
        seedEvent(target, { id: 'event-coded', createdAt: '2026-09-06T10:00:00.000', errorCode: 'resend_suppressed' });
        seedEvent(target, { id: 'event-sent', createdAt: '2026-09-06T10:00:00.000', deliveryCount: 1 });
        seedEvent(target, {
          id: 'event-stamped', createdAt: '2026-09-06T10:00:00.000',
          firstDeliverySentAt: '2026-09-06T10:00:01.000',
        });
        execSafe(target, migration357());

        expect(statusOf(target, 'event-unsent'))
          .toEqual({ routing_status: 'partial_failed', error_code: 'send_failed' });
        // 理由が既にある行は上書きしない
        expect(statusOf(target, 'event-coded'))
          .toEqual({ routing_status: 'partial_failed', error_code: 'resend_suppressed' });
        // 送った印がある行は触らない
        expect(statusOf(target, 'event-sent')).toMatchObject({ routing_status: 'completed' });
        expect(statusOf(target, 'event-stamped')).toMatchObject({ routing_status: 'completed' });
      } finally {
        target.close();
      }
    });

    it('308より前に作られた行は、delivery_count が 0 でも動かさない（送信済みの可能性がある）', () => {
      const target = freshDb();
      try {
        seedEvent(target, { id: 'event-pre308', createdAt: '2026-09-04T10:00:00.000' });
        // 適用のちょうど同時刻も「308以前の書き方かもしれない」ため動かさない
        seedEvent(target, { id: 'event-boundary', createdAt: '2026-09-05T10:00:00.000' });
        execSafe(target, migration357());

        expect(statusOf(target, 'event-pre308')).toEqual({ routing_status: 'completed', error_code: null });
        expect(statusOf(target, 'event-boundary')).toEqual({ routing_status: 'completed', error_code: null });
      } finally {
        target.close();
      }
    });

    it('308の適用記録が無い環境では1行も動かさない', () => {
      const target = freshDb({ record308: false });
      try {
        seedEvent(target, { id: 'event-unknown-era', createdAt: '2026-09-06T10:00:00.000' });
        execSafe(target, migration357());

        expect(statusOf(target, 'event-unknown-era')).toEqual({ routing_status: 'completed', error_code: null });
      } finally {
        target.close();
      }
    });
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
