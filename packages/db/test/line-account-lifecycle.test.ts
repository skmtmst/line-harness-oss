import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  activateLineAccount,
  archiveLineAccount,
  deactivateLineAccount,
  getLineAccountArchiveBlockers,
  LineAccountLifecycleError,
  listAutoSwitchedOutPoolAccounts,
  listSkippedDeliveries,
  recordPoolSwitchEvent,
  recordSkippedDelivery,
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
  it('stores and clears an official profile short URL', async () => {
    const { sqlite, db } = setup();

    const stored = await updateLineAccountFields(db, 'account-b', {
      officialProfileUrl: 'https://lin.ee/nen-official',
    });
    expect(stored?.official_profile_url).toBe('https://lin.ee/nen-official');
    expect(sqlite.prepare(
      `SELECT official_profile_url FROM line_accounts WHERE id = 'account-b'`,
    ).get()).toEqual({ official_profile_url: 'https://lin.ee/nen-official' });

    const cleared = await updateLineAccountFields(db, 'account-b', { officialProfileUrl: null });
    expect(cleared?.official_profile_url).toBeNull();
  });

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

// X-1: 送受信の停止・再開。止めた理由と時刻を残し、再開で消す。
describe('送受信の停止と再開', () => {
  it('理由つきで止めて、再開すると理由を消す', async () => {
    const { db } = setup();

    const stopped = await deactivateLineAccount(db, 'account-b', {
      reason: 'manual',
      detail: 'LINE側の不具合調査のため',
    });
    expect(stopped).toMatchObject({
      is_active: 0,
      inactive_reason: 'manual',
      inactive_reason_detail: 'LINE側の不具合調査のため',
    });
    expect(stopped?.inactivated_at).toBeTruthy();

    const resumed = await activateLineAccount(db, 'account-b');
    expect(resumed).toMatchObject({
      is_active: 1,
      inactive_reason: null,
      inactive_reason_detail: null,
      inactivated_at: null,
    });
  });

  it('既定アカウントは止められない（ACCOUNT_DEFAULT）', async () => {
    const { db } = setup();
    await expect(
      deactivateLineAccount(db, 'account-a', { reason: 'manual', detail: 'x' }),
    ).rejects.toMatchObject<Partial<LineAccountLifecycleError>>({ code: 'ACCOUNT_DEFAULT' });
  });

  it('アーカイブ済みは止められない（ACCOUNT_ARCHIVED）', async () => {
    const { sqlite, db } = setup();
    sqlite.prepare(`UPDATE line_accounts SET is_active = 0, archived_at = '2026-09-01' WHERE id = 'account-b'`).run();
    await expect(
      deactivateLineAccount(db, 'account-b', { reason: 'manual', detail: 'x' }),
    ).rejects.toMatchObject<Partial<LineAccountLifecycleError>>({ code: 'ACCOUNT_ARCHIVED' });
  });
});

// X-2: 止めている間に送らなかった配信の台帳。
describe('送れなかった配信の記録', () => {
  it('同じ配信は一度だけ残す', async () => {
    const { sqlite, db } = setup();
    const input = { lineAccountId: 'account-b', kind: 'broadcast', refId: 'bc-1', title: '朝の配信' };
    await recordSkippedDelivery(db, input);
    await recordSkippedDelivery(db, input);

    const rows = await listSkippedDeliveries(db, 'account-b');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'broadcast', ref_id: 'bc-1', reason: 'account_inactive' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM account_skipped_deliveries`).get())
      .toEqual({ c: 1 });
  });
});

// X-4: プールの自動入れ替えの記録。
describe('プール切替の記録', () => {
  it('out→in の直近状態だけを「外れ中」として返す', async () => {
    const { sqlite, db } = setup();
    sqlite.prepare(`
      INSERT INTO traffic_pools (id, slug, name, active_account_id, created_at, updated_at)
      VALUES ('pool-b', 'pool-b', 'B用', 'account-b', '2026-09-04', '2026-09-04')
    `).run();

    // out だけの account-b は「外れ中」
    await recordPoolSwitchEvent(db, { poolId: 'pool-b', lineAccountId: 'account-b', direction: 'out', reason: 'unhealthy' });
    expect(await listAutoSwitchedOutPoolAccounts(db)).toEqual([
      { pool_id: 'pool-b', line_account_id: 'account-b', switched_at: expect.any(String) },
    ]);

    // in を記録したあとは「外れ中」に出ない
    await recordPoolSwitchEvent(db, { poolId: 'pool-b', lineAccountId: 'account-b', direction: 'in', reason: 'recovered' });
    expect(await listAutoSwitchedOutPoolAccounts(db)).toEqual([]);

    // 再度 out ならまた「外れ中」に出る
    await recordPoolSwitchEvent(db, { poolId: 'pool-b', lineAccountId: 'account-b', direction: 'out', reason: 'unhealthy' });
    expect(await listAutoSwitchedOutPoolAccounts(db)).toHaveLength(1);
  });
});
