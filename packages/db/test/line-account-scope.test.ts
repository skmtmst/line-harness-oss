import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getLineAccountScopeEntries, getLineAccountLoginChannels } from '../src/line-accounts.js';
import { asD1 } from './d1-test-helper.js';

describe('LINE account authorization scope query', () => {
  it('uses the tenant index for a small tenant inside five thousand accounts and retains legacy default rows', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    try {
      const tenant = sqlite.prepare('INSERT INTO tenants(id,name) VALUES(?,?)');
      const account = sqlite.prepare(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id,display_order)
        VALUES(?,?,?,'synthetic','synthetic',?,?)`);
      sqlite.transaction(() => {
        for (let i = 0; i < 500; i++) {
          tenant.run('tenant-' + i, 'Synthetic tenant ' + i);
          for (let j = 0; j < 10; j++) {
            const id = 'account-' + (i * 10 + j);
            account.run(id, id, id, 'tenant-' + i, j);
          }
        }
        account.run('legacy', 'legacy', 'legacy', null, 0);
        account.run('default', 'default', 'default', DEFAULT_TENANT_ID, 1);
      })();
      const db = asD1(sqlite), prepare = vi.spyOn(db, 'prepare');
      expect((await getLineAccountScopeEntries(db, 'tenant-250')).map(row => row.id))
        .toEqual(Array.from({ length: 10 }, (_, i) => 'account-' + (2500 + i)));
      const query = prepare.mock.calls[0][0];
      const plans = sqlite.prepare('EXPLAIN QUERY PLAN ' + query).all('tenant-250') as Array<{ detail: string }>;
      expect(plans.some(plan => plan.detail.includes('SEARCH line_accounts USING INDEX idx_line_accounts_tenant'))).toBe(true);
      expect((await getLineAccountScopeEntries(db, DEFAULT_TENANT_ID)).map(row => row.id)).toEqual(['legacy', 'default']);
      expect(await getLineAccountScopeEntries(db, 'missing-tenant')).toEqual([]);
    } finally { sqlite.close(); }
  });

  it('filters inside D1 and never loads or decrypts credential columns', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run('tenant-b', 'B社');
    const insert = sqlite.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret,
         channel_access_token_encrypted, channel_secret_encrypted,
         login_channel_id, login_channel_secret, liff_id,
         is_active, is_default, tenant_id, display_order)
      VALUES (?, ?, ?, 'plain-token', 'plain-secret',
              'not-valid-ciphertext', 'not-valid-ciphertext',
              ?, ?, ?, 1, 0, ?, ?)
    `);
    // 542の一意制約(login_channel_id/liff_id)に合わせ、行ごとに別値を使う。
    // 絞り込み(tenant_id)・認証範囲の主張は変えない。
    insert.run('default-account', 'default-channel', '既定', 'login-id-default', 'login-secret-default', 'liff-id-default', DEFAULT_TENANT_ID, 1);
    insert.run('legacy-account', 'legacy-channel', '旧行', 'login-id-legacy', 'login-secret-legacy', 'liff-id-legacy', null, 2);
    insert.run('tenant-b-account', 'tenant-b-channel', 'B', 'login-id-tenant-b', 'login-secret-tenant-b', 'liff-id-tenant-b', 'tenant-b', 3);

    const rows = await getLineAccountScopeEntries(asD1(sqlite), DEFAULT_TENANT_ID);

    expect(rows.map((row) => row.id)).toEqual(['default-account', 'legacy-account']);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'archived_at',
      'id',
      'is_active',
      'liff_id',
      'login_channel_id',
      'parent_line_account_id',
      'tenant_id',
    ]);
    expect(rows[0]).not.toHaveProperty('channel_access_token');
    expect(rows[0]).not.toHaveProperty('channel_secret');
    expect(rows[0]).not.toHaveProperty('login_channel_secret');
    const loginChannels = await getLineAccountLoginChannels(asD1(sqlite), { accountId: 'default-account' });
    expect(loginChannels).toEqual([{ id: 'default-account', tenant_id: DEFAULT_TENANT_ID, login_channel_id: 'login-id-default' }]);
    expect(await getLineAccountLoginChannels(asD1(sqlite), { loginChannelId: 'login-id-tenant-b' }))
      .toEqual([{ id: 'tenant-b-account', tenant_id: 'tenant-b', login_channel_id: 'login-id-tenant-b' }]);
    expect(await getLineAccountLoginChannels(asD1(sqlite), { accountId: 'missing' })).toEqual([]);
    sqlite.close();
  });
});
