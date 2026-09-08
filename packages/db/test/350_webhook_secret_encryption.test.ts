import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  backfillWebhookSecrets,
  createIncomingWebhook,
  createOutgoingWebhook,
  getIncomingWebhookById,
  getOutgoingWebhookById,
  getWebhookSecretKeyStats,
  hasWebhookSecret,
  resolveWebhookSecret,
  updateOutgoingWebhook,
  webhookKeyId,
} from '../src/webhooks.js';
import { asD1 } from './d1-test-helper.js';

const packageRoot = join(import.meta.dirname, '..');
const BENIGN_SQLITE_ERROR = /duplicate column name|already exists/i;

function testKey(seed: number): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (seed * 31 + i * 7) % 256;
  return Buffer.from(bytes).toString('base64url');
}

const KEY_A = testKey(1);
const KEY_B = testKey(2);
const SECRET = `s3cr3t-${'x'.repeat(32)}`;

/** schema.sql＋全migrationを順適用した実スキーマ。手作り完成形は使わない。 */
function menerimaDatabase(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(packageRoot, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    const statements = readFileSync(join(packageRoot, 'migrations', file), 'utf8')
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      try {
        sqlite.exec(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!BENIGN_SQLITE_ERROR.test(message)) throw new Error(`${file}: ${message}`);
      }
    }
  }
  return sqlite;
}

function insertAccount(sqlite: Database.Database, account: string): void {
  sqlite.prepare(
    `INSERT OR IGNORE INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(account, `channel-${account}`, account);
}

function insertLegacyIncoming(sqlite: Database.Database, id: string, account: string): void {
  insertAccount(sqlite, account);
  sqlite.prepare(
    `INSERT INTO incoming_webhooks (id, name, secret, line_account_id) VALUES (?, '旧受信', ?, ?)`,
  ).run(id, SECRET, account);
}

function insertLegacyOutgoing(sqlite: Database.Database, id: string, account: string): void {
  insertAccount(sqlite, account);
  sqlite.prepare(
    `INSERT INTO outgoing_webhooks (id, name, url, secret, line_account_id)
     VALUES (?, '旧送信', 'https://example.com/hook', ?, ?)`,
  ).run(id, SECRET, account);
}

function legacyCount(sqlite: Database.Database): number {
  const count = (table: string): number => (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE secret IS NOT NULL AND secret_encrypted IS NULL`,
  ).get() as { n: number }).n;
  return count('incoming_webhooks') + count('outgoing_webhooks');
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.close();
  sqlite = menerimaDatabase();
  db = asD1(sqlite);
});

describe('migration 350 webhook secret の暗号化保存(#650 再審査)', () => {
  it('dry-runは件数だけ数えて書かない', async () => {
    insertLegacyIncoming(sqlite, 'in-1', 'acc-1');
    insertLegacyOutgoing(sqlite, 'out-1', 'acc-1');
    const report = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-1', dryRun: true, keys: { current: KEY_A },
    });
    expect(report.dryRun).toBe(true);
    expect(report.legacyTotal).toBe(2);
    expect(report.migrated).toBe(0);
    expect(report.done).toBe(false);
    expect(legacyCount(sqlite)).toBe(2);
  });

  it('batchで移し、中断しても呼び直せば残りが進む(失敗再開)', async () => {
    insertLegacyOutgoing(sqlite, 'out-1', 'acc-1');
    insertLegacyOutgoing(sqlite, 'out-2', 'acc-1');
    const first = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-1', dryRun: false, batchSize: 1, keys: { current: KEY_A },
    });
    expect(first.migrated).toBe(1);
    expect(first.done).toBe(false);
    expect(first.remainingLegacy).toBe(1);
    const second = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-1', dryRun: false, batchSize: 1, keys: { current: KEY_A },
    });
    expect(second.migrated).toBe(1);
    expect(second.done).toBe(true);
    expect(second.remainingLegacy).toBe(0);
    expect(legacyCount(sqlite)).toBe(0);
  });

  it('鍵が壊れている回は全件失敗扱いで平文を残し、直して呼び直すと完了する', async () => {
    insertLegacyIncoming(sqlite, 'in-1', 'acc-1');
    insertLegacyOutgoing(sqlite, 'out-1', 'acc-1');
    const failed = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-1', dryRun: false, keys: { current: 'not-a-key' },
    });
    expect(failed.migrated).toBe(0);
    expect(failed.failed.length).toBe(2);
    expect(legacyCount(sqlite)).toBe(2);
    for (const entry of failed.failed) {
      expect(entry.reason).toMatch(/^(unreadable|encrypt_failed|verify_failed|write_failed)$/);
      expect(JSON.stringify(entry)).not.toContain(SECRET);
    }
    const resumed = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-1', dryRun: false, keys: { current: KEY_A },
    });
    expect(resumed.done).toBe(true);
    expect(legacyCount(sqlite)).toBe(0);
  });

  it('新旧鍵の併用で読め、寄せ直し後に旧鍵を捨てられる(rotation)', async () => {
    insertLegacyOutgoing(sqlite, 'out-1', 'acc-1');
    await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-1', dryRun: false, keys: { current: KEY_A },
    });
    const kidA = await webhookKeyId(KEY_A);
    const kidB = await webhookKeyId(KEY_B);
    expect(kidA).not.toBe(kidB);
    const stored = (sqlite.prepare(
      `SELECT secret, secret_encrypted FROM outgoing_webhooks WHERE id = 'out-1'`,
    ).get() as { secret: string | null; secret_encrypted: string });
    expect(stored.secret).toBeNull();
    expect(stored.secret_encrypted.startsWith(`k${kidA}.v1.`)).toBe(true);

    // 併用期間: 新鍵だけでは読めないが、旧鍵を添えれば読める。
    await expect(resolveWebhookSecret(stored, { current: KEY_B })).rejects.toThrow();
    expect(await resolveWebhookSecret(stored, { current: KEY_B, previous: KEY_A })).toBe(SECRET);

    // 寄せ直し: 旧鍵の行を新鍵で暗号化し直す。
    const rekey = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-1', dryRun: false, keys: { current: KEY_B, previous: KEY_A },
    });
    expect(rekey.rekeyTotal).toBe(1);
    expect(rekey.done).toBe(true);
    const restorted = (sqlite.prepare(
      `SELECT secret, secret_encrypted FROM outgoing_webhooks WHERE id = 'out-1'`,
    ).get() as { secret: string | null; secret_encrypted: string });
    expect(restorted.secret_encrypted.startsWith(`k${kidB}.v1.`)).toBe(true);
    expect(await resolveWebhookSecret(restorted, { current: KEY_B })).toBe(SECRET);

    // 廃止照合: 旧鍵IDの参照が0件になった。
    const stats = await getWebhookSecretKeyStats(db, 'acc-1');
    expect(stats.legacy).toBe(0);
    expect(stats.byKeyId[kidA] ?? 0).toBe(0);
    expect(stats.byKeyId[kidB]).toBe(1);
  });

  it('完了時は平文残0件・全行が鍵ID付きで、DB断片に平文が出ない', async () => {
    insertLegacyIncoming(sqlite, 'in-1', 'acc-1');
    insertLegacyOutgoing(sqlite, 'out-1', 'acc-1');
    await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-1', dryRun: false, keys: { current: KEY_A },
    });
    expect(legacyCount(sqlite)).toBe(0);
    const dump = [
      ...sqlite.prepare(`SELECT secret_encrypted AS v FROM incoming_webhooks`).all() as Array<{ v: string }>,
      ...sqlite.prepare(`SELECT secret_encrypted AS v FROM outgoing_webhooks`).all() as Array<{ v: string }>,
    ];
    expect(dump.length).toBe(2);
    for (const row of dump) {
      expect(row.v).toMatch(/^k[0-9a-f]{12}\.v1\..+/);
      expect(row.v).not.toContain(SECRET);
    }
  });

  it('作成・入れ直しは現行鍵の鍵ID付きで保存し、鍵なし作成は例外にする', async () => {
    insertAccount(sqlite, 'acc-1');
    const created = await createOutgoingWebhook(
      db,
      { name: '送信', url: 'https://example.com/hook', eventTypes: ['*'], secret: SECRET, lineAccountId: 'acc-1' },
      { current: KEY_A },
    );
    const kidA = await webhookKeyId(KEY_A);
    expect(created.secret).toBeNull();
    expect(created.secret_encrypted?.startsWith(`k${kidA}.v1.`)).toBe(true);
    const rotated = `r0tated-${'y'.repeat(32)}`;
    await updateOutgoingWebhook(db, created.id, 'acc-1', { secret: rotated }, { current: KEY_A });
    const row = (await getOutgoingWebhookById(db, created.id, 'acc-1'))!;
    expect(await resolveWebhookSecret(row, { current: KEY_A })).toBe(rotated);
    await expect(
      createIncomingWebhook(db, { name: '受信', secret: SECRET, lineAccountId: 'acc-1' }),
    ).rejects.toThrow();
    expect(legacyCount(sqlite)).toBe(0);
  });

  it('hasWebhookSecretは未設定と短い旧平文をfalseにする', () => {
    expect(hasWebhookSecret({ secret: null, secret_encrypted: null })).toBe(false);
    expect(hasWebhookSecret({ secret: 'short', secret_encrypted: null })).toBe(false);
    expect(hasWebhookSecret({ secret: SECRET, secret_encrypted: null })).toBe(true);
    expect(hasWebhookSecret({ secret: null, secret_encrypted: 'k0123456789ab.v1.x.y' })).toBe(true);
  });
});
