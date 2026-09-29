import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createIncomingWebhook,
  resolvePreviousWebhookSecret,
  updateIncomingWebhook,
} from './webhooks.js';

/*
 * R424: 合言葉更新の応答消失後に同じ値を再保存しても、
 * 旧合言葉の24時間猶予は消えない。
 *
 * 落ち方（直前）: 同じNEWの再保存で previous も rotated_at も上書きされ、
 *   OLD署名が401になる（詳細は猶予ありと返す矛盾つき）。
 * 通り方（直後）: 同じ値の再保存は重複操作として previous と失効時刻を保つ。
 *   別値への変更だけが猶予を作り直す。
 *
 * 実SQLite(bootstrap.sql)で確かめる。
 */

const packageRoot = join(import.meta.dirname, '..');
const bootstrap = readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  } as unknown as D1Database;
}

const KEY = randomBytes(32).toString('base64url');
const KEYS = { current: KEY };
const OLD_SECRET = 'old-secret-0123456789abcdef-old-secret';
const NEW_SECRET = 'new-secret-0123456789abcdef-new-secret';
const OTHER_SECRET = 'other-secret-0123456789abcdef-other';

let sqlite: Database.Database;
let db: D1Database;

type SecretRow = {
  secret_encrypted: string | null;
  secret_previous_encrypted: string | null;
  secret_rotated_at: string | null;
};

function secretRow(id: string): SecretRow {
  return sqlite.prepare(
    `SELECT secret_encrypted, secret_previous_encrypted, secret_rotated_at
       FROM incoming_webhooks WHERE id = ?`,
  ).get(id) as SecretRow;
}

async function previousSecret(id: string): Promise<string | null> {
  const row = secretRow(id);
  return resolvePreviousWebhookSecret(
    {
      secret: null,
      secret_encrypted: row.secret_encrypted,
      secret_previous_encrypted: row.secret_previous_encrypted,
      secret_rotated_at: row.secret_rotated_at,
    },
    KEYS,
  );
}

describe('R424 同じ合言葉の再保存は猶予を保つ', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(bootstrap);
    sqlite.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    sqlite.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
      VALUES ('account-1', 'ch-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
    `).run();
    db = asD1(sqlite);
  });

  it('OLD→NEW成功後の同じNEW再保存でもOLDが期限まで有効', async () => {
    const created = await createIncomingWebhook(
      db,
      { name: '受信口', secret: OLD_SECRET, lineAccountId: 'account-1' },
      KEYS,
    );
    await updateIncomingWebhook(db, created.id, 'account-1', { secret: NEW_SECRET }, KEYS);
    expect(await previousSecret(created.id)).toBe(OLD_SECRET);
    const rotatedAt = secretRow(created.id).secret_rotated_at;

    // 保存の返答だけが失われた条件で、同じNEWを再保存する。
    await updateIncomingWebhook(db, created.id, 'account-1', { secret: NEW_SECRET }, KEYS);

    expect(await previousSecret(created.id)).toBe(OLD_SECRET);
    expect(secretRow(created.id).secret_rotated_at).toBe(rotatedAt);
  });

  it('別値への変更は残る旧値の扱いを作り直す', async () => {
    const created = await createIncomingWebhook(
      db,
      { name: '受信口', secret: OLD_SECRET, lineAccountId: 'account-1' },
      KEYS,
    );
    await updateIncomingWebhook(db, created.id, 'account-1', { secret: NEW_SECRET }, KEYS);
    await updateIncomingWebhook(db, created.id, 'account-1', { secret: OTHER_SECRET }, KEYS);
    expect(await previousSecret(created.id)).toBe(NEW_SECRET);
  });
});
