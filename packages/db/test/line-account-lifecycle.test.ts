import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  archiveLineAccount,
  getLineAccountArchiveBlockers,
  LineAccountLifecycleError,
  restoreLineAccount,
  setDefaultLineAccount,
  updateLineAccountFields,
} from '../src/line-accounts.js';
import { asD1 } from './d1-test-helper.js';

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES (?, ?)`).run('tenant-a', 'A社');
  const insert = sqlite.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret,
       is_active, is_default, tenant_id)
    VALUES (?, ?, ?, 'token', 'secret', ?, ?, 'tenant-a')
  `);
  insert.run('account-a', 'channel-a', 'A', 1, 1);
  insert.run('account-b', 'channel-b', 'B', 1, 0);
  return { sqlite, db: asD1(sqlite) };
}

describe('LINE account default and archive lifecycle', () => {
  it('keeps exactly one active default in an organization', async () => {
    const { sqlite, db } = setup();

    const changed = await setDefaultLineAccount(db, 'account-b', 'tenant-a');

    expect(changed?.is_default).toBe(1);
    expect(sqlite.prepare(
      `SELECT id FROM line_accounts WHERE tenant_id = 'tenant-a' AND is_default = 1`,
    ).all()).toEqual([{ id: 'account-b' }]);
    expect(() => sqlite.prepare(
      `UPDATE line_accounts SET is_default = 1 WHERE id = 'account-a'`,
    ).run()).toThrow(/UNIQUE constraint failed/);
    await expect(updateLineAccountFields(db, 'account-b', { isActive: false }))
      .rejects.toMatchObject<Partial<LineAccountLifecycleError>>({ code: 'ACCOUNT_DEFAULT' });
  });

  it('checks delivery and pool blockers, archives without deleting, then restores stopped', async () => {
    const { sqlite, db } = setup();
    sqlite.prepare(`UPDATE line_accounts SET is_active = 0 WHERE id = 'account-b'`).run();
    sqlite.prepare(`
      INSERT INTO broadcasts
        (id, title, message_type, message_content, status, line_account_id)
      VALUES ('broadcast-b', '予約配信', 'text', '本文', 'scheduled', 'account-b')
    `).run();
    sqlite.prepare(`
      INSERT INTO traffic_pools
        (id, slug, name, active_account_id, created_at, updated_at)
      VALUES ('pool-b', 'pool-b', 'B用', 'account-b', '2026-09-04', '2026-09-04')
    `).run();

    await expect(getLineAccountArchiveBlockers(db, 'account-b')).resolves.toEqual([
      'delivery_job_running',
      'traffic_pool_member',
    ]);
    await expect(archiveLineAccount(db, 'account-b', 'owner-a', '利用終了'))
      .rejects.toMatchObject<Partial<LineAccountLifecycleError>>({
        code: 'ACCOUNT_HAS_ACTIVE_DELIVERY',
      });

    sqlite.prepare(`DELETE FROM broadcasts WHERE id = 'broadcast-b'`).run();
    sqlite.prepare(`DELETE FROM traffic_pools WHERE id = 'pool-b'`).run();
    const archived = await archiveLineAccount(db, 'account-b', 'owner-a', '利用終了');
    expect(archived).toMatchObject({
      id: 'account-b',
      is_active: 0,
      is_default: 0,
      archived_by: 'owner-a',
      archived_reason: '利用終了',
    });
    expect(archived?.archived_at).toBeTruthy();
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM line_accounts WHERE id = 'account-b'`).get())
      .toEqual({ count: 1 });
    await expect(updateLineAccountFields(db, 'account-b', { role: 'retired' }))
      .rejects.toMatchObject<Partial<LineAccountLifecycleError>>({ code: 'ACCOUNT_ARCHIVED' });

    const restored = await restoreLineAccount(db, 'account-b');
    expect(restored).toMatchObject({
      id: 'account-b',
      is_active: 0,
      is_default: 0,
      archived_at: null,
      archived_by: null,
      archived_reason: null,
    });
  });
});
