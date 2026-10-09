import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getLineAccountConnectionChecksByIdempotencyKey,
  getLineAccountListStats,
  LineAccountRevisionConflictError,
  saveLineAccountConnectionChecks,
  type SaveLineAccountConnectionChecksInput,
} from '../src/line-accounts.js';
import { asD1 } from './d1-test-helper.js';

const connections: Database.Database[] = [];
afterEach(() => {
  for (const sqlite of connections.splice(0)) sqlite.close();
});

function setup() {
  const sqlite = new Database(':memory:');
  connections.push(sqlite);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '接続確認', 'token', 'secret');
  `);
  return { sqlite, db: asD1(sqlite) };
}

function input(idempotencyKey: string, expectedRevision = 1): SaveLineAccountConnectionChecksInput {
  return {
    lineAccountId: 'account-a', expectedRevision, checkedBy: 'staff-a',
    checkedAt: '2026-10-08T17:00:00.000+09:00', correlationId: `correlation-${idempotencyKey}`,
    idempotencyKey,
    checks: [
      { kind: 'bot_info', result: 'ok', httpStatus: 200 },
      { kind: 'webhook_endpoint', result: 'matched', webhookActive: true },
      { kind: 'webhook_test', result: 'ok', httpStatus: 200 },
      { kind: 'liff_config', result: 'ok' },
    ],
  };
}

describe('connection-check CAS owns every persisted result (PKG20)', () => {
  it('rejects a delayed different-key run without adding checks or changing latest health', async () => {
    const { sqlite, db } = setup();
    // Both requests read revision 1. The first finishes its external checks and
    // commits while the second is still waiting. The second then submits later.
    const winner = input('winner-key');
    const delayed = input('delayed-key');
    delayed.checkedAt = '2026-10-08T17:01:00.000+09:00';
    delayed.checkedBy = 'staff-delayed';
    delayed.checks = delayed.checks.map((check) => ({ ...check, result: 'failed' }));
    await saveLineAccountConnectionChecks(db, winner);
    const beforeRows = sqlite.prepare('SELECT * FROM line_account_connection_checks ORDER BY check_kind').all();
    const beforeHealth = await getLineAccountListStats(db, ['account-a']);

    await expect(saveLineAccountConnectionChecks(db, delayed))
      .rejects.toBeInstanceOf(LineAccountRevisionConflictError);

    expect(sqlite.prepare('SELECT * FROM line_account_connection_checks ORDER BY check_kind').all())
      .toEqual(beforeRows);
    expect(await getLineAccountListStats(db, ['account-a'])).toEqual(beforeHealth);
    expect(await getLineAccountConnectionChecksByIdempotencyKey(db, 'account-a', 'delayed-key'))
      .toEqual([]);
    expect(sqlite.prepare('SELECT revision, updated_at FROM line_accounts WHERE id = ?').get('account-a'))
      .toEqual({ revision: 2, updated_at: winner.checkedAt });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('persists all checks after each successful revision update and keeps original key results', async () => {
    const { sqlite, db } = setup();
    const first = await saveLineAccountConnectionChecks(db, input('first-key'));
    const second = await saveLineAccountConnectionChecks(db, input('second-key', 2));
    expect(first).toHaveLength(4);
    expect(second).toHaveLength(4);
    expect(first.every((check) => check.account_revision === 2)).toBe(true);
    expect(second.every((check) => check.account_revision === 3)).toBe(true);
    expect(await getLineAccountConnectionChecksByIdempotencyKey(db, 'account-a', 'first-key')).toEqual(first);
    expect(sqlite.prepare('SELECT revision FROM line_accounts WHERE id = ?').get('account-a'))
      .toEqual({ revision: 3 });
  });

  it('rejects an archived account without persisting any checks', async () => {
    const { sqlite, db } = setup();
    sqlite.prepare('UPDATE line_accounts SET archived_at = ? WHERE id = ?')
      .run('2026-10-08T16:00:00.000+09:00', 'account-a');
    await expect(saveLineAccountConnectionChecks(db, input('archived-key')))
      .rejects.toBeInstanceOf(LineAccountRevisionConflictError);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM line_account_connection_checks').get())
      .toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT revision FROM line_accounts WHERE id = ?').get('account-a'))
      .toEqual({ revision: 1 });
  });

  it('rolls back the revision and every preceding insert when a later check violates a constraint', async () => {
    const { sqlite, db } = setup();
    const duplicate = input('duplicate-key');
    duplicate.checks.push({ kind: 'bot_info', result: 'ok' });
    await expect(saveLineAccountConnectionChecks(db, duplicate)).rejects.toThrow(/UNIQUE/);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM line_account_connection_checks').get())
      .toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT revision FROM line_accounts WHERE id = ?').get('account-a'))
      .toEqual({ revision: 1 });
  });
});
