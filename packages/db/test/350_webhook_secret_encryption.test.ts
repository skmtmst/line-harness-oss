import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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

function legacyCount(sqlite: Database.Database, account: string): number {
  const count = (table: string): number => (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM ${table}
      WHERE line_account_id = ? AND secret IS NOT NULL`,
  ).get(account) as { n: number }).n;
  return count('incoming_webhooks') + count('outgoing_webhooks');
}

let sqlite: Database.Database;
let db: D1Database;

// 実migrationの適用は重いので1ファイル1回。テスト同士はアカウントで分離する。
beforeAll(() => {
  sqlite = menerimaDatabase();
  db = asD1(sqlite);
});

describe('migration 350 webhook secret の暗号化保存(#650 再審査)', () => {
  it('dry-runは件数だけ数えて書かない', async () => {
    insertLegacyIncoming(sqlite, 'dry-in-1', 'acc-dry');
    insertLegacyOutgoing(sqlite, 'dry-out-1', 'acc-dry');
    const report = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-dry', dryRun: true, keys: { current: KEY_A },
    });
    expect(report.dryRun).toBe(true);
    expect(report.legacyTotal).toBe(2);
    expect(report.migrated).toBe(0);
    expect(report.done).toBe(false);
    expect(legacyCount(sqlite, 'acc-dry')).toBe(2);
  });

  it('batchで移し、中断しても呼び直せば残りが進む(失敗再開)', async () => {
    insertLegacyOutgoing(sqlite, 'bat-out-1', 'acc-bat');
    insertLegacyOutgoing(sqlite, 'bat-out-2', 'acc-bat');
    const first = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-bat', dryRun: false, batchSize: 1, keys: { current: KEY_A },
    });
    expect(first.migrated).toBe(1);
    expect(first.done).toBe(false);
    expect(first.remainingLegacy).toBe(1);
    const second = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-bat', dryRun: false, batchSize: 1, keys: { current: KEY_A },
    });
    expect(second.migrated).toBe(1);
    expect(second.done).toBe(true);
    expect(second.remainingLegacy).toBe(0);
    expect(legacyCount(sqlite, 'acc-bat')).toBe(0);
  });

  it('鍵が壊れている回は全件失敗扱いで平文を残し、直して呼び直すと完了する', async () => {
    insertLegacyIncoming(sqlite, 'fail-in-1', 'acc-fail');
    insertLegacyOutgoing(sqlite, 'fail-out-1', 'acc-fail');
    const failed = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-fail', dryRun: false, keys: { current: 'not-a-key' },
    });
    expect(failed.migrated).toBe(0);
    expect(failed.failed.length).toBe(2);
    expect(legacyCount(sqlite, 'acc-fail')).toBe(2);
    for (const entry of failed.failed) {
      expect(entry.reason).toMatch(/^(unreadable|encrypt_failed|verify_failed|write_failed)$/);
      expect(JSON.stringify(entry)).not.toContain(SECRET);
    }
    const resumed = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-fail', dryRun: false, keys: { current: KEY_A },
    });
    expect(resumed.done).toBe(true);
    expect(legacyCount(sqlite, 'acc-fail')).toBe(0);
  });

  it('新旧鍵の併用で読め、寄せ直し後に旧鍵を捨てられる(rotation)', async () => {
    insertLegacyOutgoing(sqlite, 'rot-out-1', 'acc-rot');
    await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-rot', dryRun: false, keys: { current: KEY_A },
    });
    const kidA = await webhookKeyId(KEY_A);
    const kidB = await webhookKeyId(KEY_B);
    expect(kidA).not.toBe(kidB);
    const stored = (sqlite.prepare(
      `SELECT secret, secret_encrypted FROM outgoing_webhooks WHERE id = 'rot-out-1'`,
    ).get() as { secret: string | null; secret_encrypted: string });
    expect(stored.secret).toBeNull();
    expect(stored.secret_encrypted.startsWith(`k${kidA}.v1.`)).toBe(true);

    // 併用期間: 新鍵だけでは読めないが、旧鍵を添えれば読める。
    await expect(resolveWebhookSecret(stored, { current: KEY_B })).rejects.toThrow();
    expect(await resolveWebhookSecret(stored, { current: KEY_B, previous: KEY_A })).toBe(SECRET);

    // 寄せ直し: 旧鍵の行を新鍵で暗号化し直す。
    const rekey = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-rot', dryRun: false, keys: { current: KEY_B, previous: KEY_A },
    });
    expect(rekey.rekeyTotal).toBe(1);
    expect(rekey.done).toBe(true);
    const restorted = (sqlite.prepare(
      `SELECT secret, secret_encrypted FROM outgoing_webhooks WHERE id = 'rot-out-1'`,
    ).get() as { secret: string | null; secret_encrypted: string });
    expect(restorted.secret_encrypted.startsWith(`k${kidB}.v1.`)).toBe(true);
    expect(await resolveWebhookSecret(restorted, { current: KEY_B })).toBe(SECRET);

    // 廃止照合: 旧鍵IDの参照が0件になった。
    const stats = await getWebhookSecretKeyStats(db, 'acc-rot');
    expect(stats.legacy).toBe(0);
    expect(stats.byKeyId[kidA] ?? 0).toBe(0);
    expect(stats.byKeyId[kidB]).toBe(1);
  });

  it('完了時は平文残0件・全行が鍵ID付きで、DB断片に平文が出ない', async () => {
    insertLegacyIncoming(sqlite, 'done-in-1', 'acc-done');
    insertLegacyOutgoing(sqlite, 'done-out-1', 'acc-done');
    await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-done', dryRun: false, keys: { current: KEY_A },
    });
    expect(legacyCount(sqlite, 'acc-done')).toBe(0);
    const dump = [
      ...sqlite.prepare(`SELECT secret_encrypted AS v FROM incoming_webhooks WHERE line_account_id = 'acc-done'`).all() as Array<{ v: string }>,
      ...sqlite.prepare(`SELECT secret_encrypted AS v FROM outgoing_webhooks WHERE line_account_id = 'acc-done'`).all() as Array<{ v: string }>,
    ];
    expect(dump.length).toBe(2);
    for (const row of dump) {
      expect(row.v).toMatch(/^k[0-9a-f]{12}\.v1\..+/);
      expect(row.v).not.toContain(SECRET);
    }
  });

  it('作成・入れ直しは現行鍵の鍵ID付きで保存し、鍵なし作成は例外にする', async () => {
    insertAccount(sqlite, 'acc-new');
    const created = await createOutgoingWebhook(
      db,
      { name: '送信', url: 'https://example.com/hook', eventTypes: ['*'], secret: SECRET, lineAccountId: 'acc-new' },
      { current: KEY_A },
    );
    const kidA = await webhookKeyId(KEY_A);
    expect(created.secret).toBeNull();
    expect(created.secret_encrypted?.startsWith(`k${kidA}.v1.`)).toBe(true);
    const rotated = `r0tated-${'y'.repeat(32)}`;
    await updateOutgoingWebhook(db, created.id, 'acc-new', { secret: rotated }, { current: KEY_A });
    const row = (await getOutgoingWebhookById(db, created.id, 'acc-new'))!;
    expect(await resolveWebhookSecret(row, { current: KEY_A })).toBe(rotated);
    await expect(
      createIncomingWebhook(db, { name: '受信', secret: SECRET, lineAccountId: 'acc-new' }),
    ).rejects.toThrow();
    expect(legacyCount(sqlite, 'acc-new')).toBe(0);
  });

  /**
   * 「列がNULL」では平文が消えた証拠にならない。SQLiteは解放した領域を
   * 消さないので、生のDB像に平文が残ることがある。移行と再保存のあと、
   * DBファイルの生バイトに平文が1度も出ないことをここで見張る(#650)。
   * この検査に使う印は、この試験だけが入れる値にしてある。
   */
  it('移行後のDB像・ログ・例外の本文に平文が1度も出ない', async () => {
    const marker = `residue-marker-${'q'.repeat(32)}`;
    const image = (): Buffer => Buffer.from(sqlite.serialize());
    expect(image().includes(Buffer.from(marker))).toBe(false);

    insertAccount(sqlite, 'acc-residue');
    sqlite.prepare(
      `INSERT INTO incoming_webhooks (id, name, secret, line_account_id) VALUES ('res-in-1', '旧受信', ?, 'acc-residue')`,
    ).run(marker);
    sqlite.prepare(
      `INSERT INTO outgoing_webhooks (id, name, url, secret, line_account_id)
       VALUES ('res-out-1', '旧送信', 'https://example.com/hook', ?, 'acc-residue')`,
    ).run(marker);
    expect(image().includes(Buffer.from(marker))).toBe(true);

    const report = await backfillWebhookSecrets(db, {
      lineAccountId: 'acc-residue', dryRun: false, keys: { current: KEY_A },
    });
    expect(report.migrated).toBe(2);
    expect(report.done).toBe(true);
    expect(legacyCount(sqlite, 'acc-residue')).toBe(0);
    // 列だけでなくDB像そのものに平文が残っていないこと。
    expect(image().includes(Buffer.from(marker))).toBe(false);

    // 新規作成も同じ。平文はどの列にも、DB像にも入らない。
    const created = `fresh-marker-${'w'.repeat(32)}`;
    await createOutgoingWebhook(db, {
      name: '新規', url: 'https://example.com/new', eventTypes: [],
      secret: created, lineAccountId: 'acc-residue',
    }, { current: KEY_A });
    expect(image().includes(Buffer.from(created))).toBe(false);

    // 復号できない行を触ったときのログと例外にも平文・鍵を出さない。
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    });
    let thrown = '';
    try {
      await resolveWebhookSecret(
        { id: 'res-broken', secret: null, secret_encrypted: 'k000000000000.v1.zzz.zzz' },
        { current: KEY_A },
      );
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    } finally {
      spy.mockRestore();
    }
    expect(thrown).not.toBe('');
    for (const line of [...logs, thrown]) {
      expect(line).not.toContain(marker);
      expect(line).not.toContain(created);
      expect(line).not.toContain(KEY_A);
      expect(line).not.toContain(SECRET);
    }
  });

  it('hasWebhookSecretは未設定と短い旧平文をfalseにする', () => {
    expect(hasWebhookSecret({ secret: null, secret_encrypted: null })).toBe(false);
    expect(hasWebhookSecret({ secret: 'short', secret_encrypted: null })).toBe(false);
    expect(hasWebhookSecret({ secret: SECRET, secret_encrypted: null })).toBe(true);
    expect(hasWebhookSecret({ secret: null, secret_encrypted: 'k0123456789ab.v1.x.y' })).toBe(true);
  });
});
