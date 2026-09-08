import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createIncomingWebhook,
  createOutgoingWebhook,
  getIncomingWebhookById,
  getOutgoingWebhookById,
  hasWebhookSecret,
  resolveWebhookSecret,
  updateIncomingWebhook,
  updateOutgoingWebhook,
} from '../src/webhooks.js';
import { asD1 } from './d1-test-helper.js';

function testKey(seed: number): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (seed * 31 + i * 7) % 256;
  return Buffer.from(bytes).toString('base64url');
}

const KEY = testKey(1);
const OTHER_KEY = testKey(2);
const SECRET = `s3cr3t-${'x'.repeat(32)}`;

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE incoming_webhooks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'custom',
      secret TEXT, secret_encrypted TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      line_account_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      identity_match_json TEXT NOT NULL DEFAULT '{}',
      action_refs_json TEXT NOT NULL DEFAULT '[]',
      latest_masked_sample_json TEXT, latest_received_at TEXT,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE outgoing_webhooks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
      event_types TEXT NOT NULL DEFAULT '[]',
      secret TEXT, secret_encrypted TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_failed_at TEXT, line_account_id TEXT,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  db = asD1(sqlite);
});

describe('migration 350 webhook secret の暗号化保存(#650)', () => {
  it('作成時は暗号化して保存し、平文を残さない', async () => {
    const incoming = await createIncomingWebhook(
      db, { name: '受信', secret: SECRET, lineAccountId: 'acc-1' }, KEY,
    );
    expect(incoming.secret).toBeNull();
    expect(incoming.secret_encrypted?.startsWith('v1.')).toBe(true);
    expect(incoming.secret_encrypted).not.toContain(SECRET);
    expect(await resolveWebhookSecret(incoming, KEY)).toBe(SECRET);

    const outgoing = await createOutgoingWebhook(
      db,
      { name: '送信', url: 'https://example.com/hook', eventTypes: ['*'], secret: SECRET, lineAccountId: 'acc-1' },
      KEY,
    );
    expect(outgoing.secret).toBeNull();
    expect(outgoing.secret_encrypted?.startsWith('v1.')).toBe(true);
    expect(await resolveWebhookSecret(outgoing, KEY)).toBe(SECRET);
    expect(hasWebhookSecret(outgoing)).toBe(true);
  });

  it('旧平文の行は読めて、再保存時に暗号化へ移行する', async () => {
    sqlite.prepare(
      `INSERT INTO incoming_webhooks (id, name, secret, line_account_id, created_at, updated_at)
       VALUES ('legacy-1', '旧', ?, 'acc-1', '', '')`,
    ).run(SECRET);
    const before = (await getIncomingWebhookById(db, 'legacy-1', 'acc-1'))!;
    expect(await resolveWebhookSecret(before, KEY)).toBe(SECRET);
    expect(hasWebhookSecret(before)).toBe(true);

    await updateIncomingWebhook(db, 'legacy-1', 'acc-1', { name: '旧・改名' }, KEY);
    const after = (await getIncomingWebhookById(db, 'legacy-1', 'acc-1'))!;
    expect(after.name).toBe('旧・改名');
    expect(after.secret).toBeNull();
    expect(after.secret_encrypted?.startsWith('v1.')).toBe(true);
    expect(await resolveWebhookSecret(after, KEY)).toBe(SECRET);
  });

  it('2回目の保存が残り、secretの入れ直しで再暗号化する', async () => {
    const created = await createOutgoingWebhook(
      db,
      { name: '送信', url: 'https://example.com/hook', eventTypes: ['*'], secret: SECRET, lineAccountId: 'acc-1' },
      KEY,
    );
    const rotated = `r0tated-${'y'.repeat(32)}`;
    await updateOutgoingWebhook(db, created.id, 'acc-1', { secret: rotated }, KEY);
    await updateOutgoingWebhook(db, created.id, 'acc-1', { name: '送信・改名' }, KEY);
    const row = (await getOutgoingWebhookById(db, created.id, 'acc-1'))!;
    expect(row.name).toBe('送信・改名');
    expect(row.secret).toBeNull();
    expect(await resolveWebhookSecret(row, KEY)).toBe(rotated);
  });

  it('鍵なしの作成は例外にし、平文を保存しない', async () => {
    await expect(
      createIncomingWebhook(db, { name: '受信', secret: SECRET, lineAccountId: 'acc-1' }),
    ).rejects.toThrow();
    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM incoming_webhooks').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('別鍵では復号できず、例外や行に秘密値が出ない', async () => {
    const created = await createIncomingWebhook(
      db, { name: '受信', secret: SECRET, lineAccountId: 'acc-1' }, KEY,
    );
    const error = await resolveWebhookSecret(created, OTHER_KEY).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(SECRET);
    expect(JSON.stringify(created)).not.toContain(SECRET);
  });

  it('hasWebhookSecretは未設定と短い旧平文をfalseにする', () => {
    expect(hasWebhookSecret({ secret: null, secret_encrypted: null })).toBe(false);
    expect(hasWebhookSecret({ secret: 'short', secret_encrypted: null })).toBe(false);
    expect(hasWebhookSecret({ secret: SECRET, secret_encrypted: null })).toBe(true);
    expect(hasWebhookSecret({ secret: null, secret_encrypted: 'v1.x.y' })).toBe(true);
  });
});
