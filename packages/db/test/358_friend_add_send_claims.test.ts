import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  claimFriendAddSendRight,
  touchFriendAddSendClaim,
  releaseFriendAddSendRight,
} from '../src/friend-add-events.js';

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
 * 移行の再生は全部同期で走る。テストごとに繰り返すとその間ワーカーが
 * 止まるので、1度だけ組み立てて中身を控え、以後は写しから起こす。
 */
let migratedSnapshot: Buffer | null = null;

function setupDb(): Database.Database {
  if (migratedSnapshot) return new Database(migratedSnapshot);
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  migratedSnapshot = db.serialize();
  return db;
}

/** changes を返す最小のD1代替。 */
function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              const info = stmt.run(...params);
              return { success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const NOW = '2026-09-08T10:00:00.000+09:00';

describe('358 friend_add_send_claims', () => {
  let raw: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    raw = setupDb();
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1')`,
    ).run();
    raw.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id)
       VALUES ('friend-1', 'U-1', 'account-1'), ('friend-2', 'U-2', 'account-1')`,
    ).run();
    db = asD1(raw);
  });

  afterEach(() => raw.close());

  it('先に予約した実行だけが送れる', async () => {
    await expect(
      claimFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', now: NOW }),
    ).resolves.toEqual({ held: true, generation: 1, previousDispatchUnknown: false });
    // 別webhook IDの並行実行は引く
    await expect(
      claimFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', now: NOW }),
    ).resolves.toEqual({ held: false, generation: 0, previousDispatchUnknown: false });
    // 別の友だちは関係ない
    await expect(
      claimFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-2', eventId: 'event-c', now: NOW }),
    ).resolves.toEqual({ held: true, generation: 1, previousDispatchUnknown: false });
  });

  it('解放したら次の実行が予約できる', async () => {
    const first = await claimFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', now: NOW });
    // 他人の予約は世代が合わないので消せない
    await releaseFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-x', generation: first.generation });
    await expect(
      claimFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', now: NOW }),
    ).resolves.toEqual({ held: false, generation: 0, previousDispatchUnknown: false });
    await releaseFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', generation: first.generation });
    await expect(
      claimFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', now: NOW }),
    ).resolves.toEqual({ held: true, generation: 1, previousDispatchUnknown: false });
  });

  it('古い予約（処理中に落ちた残り）は世代を進めて奪い直せる', async () => {
    raw.prepare(
      `INSERT INTO friend_add_send_claims (line_account_id, friend_id, event_id, generation, claimed_at)
       VALUES ('account-1', 'friend-1', 'event-crashed', 1, '2026-09-08T09:00:00.000+09:00')`,
    ).run();
    await expect(
      claimFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-new', now: NOW }),
    ).resolves.toEqual({ held: true, generation: 2, previousDispatchUnknown: false });
  });

  it('回収後の旧持ち主は持ち主でない', async () => {
    const first = await claimFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', now: NOW });
    await expect(
      touchFriendAddSendClaim(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', generation: first.generation }),
    ).resolves.toBe(true);
    // 別の持ち主は持ち主でない
    await expect(
      touchFriendAddSendClaim(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', generation: first.generation }),
    ).resolves.toBe(false);
    // 予約を古くして回収させると世代が進み、旧持ち主は弾かれる
    raw.prepare(
      `UPDATE friend_add_send_claims SET claimed_at = '2026-09-08T09:00:00.000+09:00'
        WHERE line_account_id = 'account-1' AND friend_id = 'friend-1'`,
    ).run();
    const stolen = await claimFriendAddSendRight(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b',
      now: '2026-09-08T10:10:00.000+09:00',
    });
    expect(stolen).toEqual({ held: true, generation: 2, previousDispatchUnknown: false });
    await expect(
      touchFriendAddSendClaim(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', generation: first.generation }),
    ).resolves.toBe(false);
    await expect(
      touchFriendAddSendClaim(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', generation: stolen.generation }),
    ).resolves.toBe(true);
    // 回収で進んだ世代の予約は、旧世代では消せない
    await releaseFriendAddSendRight(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', generation: first.generation });
    await expect(
      touchFriendAddSendClaim(db, { lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', generation: stolen.generation }),
    ).resolves.toBe(true);
  });
});
