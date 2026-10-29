import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { listAccessUsers } from '../src/access-audit.js';
import { asD1 } from './d1-test-helper.js';

describe('access users for a selected account', () => {
  it('shows its creator and members without other HQ members or account IDs', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    const staff = sqlite.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope)
      VALUES (?,?,'admin',?,?,?)`);
    staff.run('creator', '作成者', 'key-creator', DEFAULT_TENANT_ID, 'all');
    staff.run('hq-other', '他の統括', 'key-hq-other', DEFAULT_TENANT_ID, 'all');
    staff.run('hq-admin', '兼任管理者', 'key-hq-admin', DEFAULT_TENANT_ID, 'all');
    staff.run('account-member', '担当者', 'key-account-member', DEFAULT_TENANT_ID, 'accounts');
    staff.run('other-account-member', '別アカウント担当者', 'key-other', DEFAULT_TENANT_ID, 'accounts');
    const account = sqlite.prepare(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id,created_by_staff_id)
      VALUES (?,? ,?,'token','secret',?,?)`);
    account.run('account-a', 'channel-a', 'A', DEFAULT_TENANT_ID, 'creator');
    account.run('account-b', 'channel-b', 'B', DEFAULT_TENANT_ID, 'hq-other');
    const scope = sqlite.prepare(`INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES (?,?,datetime('now'))`);
    scope.run('account-member', 'account-a');
    scope.run('account-member', 'account-b');
    scope.run('other-account-member', 'account-b');
    sqlite.prepare('INSERT INTO line_account_hq_admin_memberships(line_account_id,staff_id) VALUES (?,?)')
      .run('account-a', 'hq-admin');

    const result = await listAccessUsers(asD1(sqlite), {
      tenantId: DEFAULT_TENANT_ID,
      allowedLineAccountIds: ['account-a'],
      lineAccountId: 'account-a',
    });
    expect(result.items.map((item) => item.id).sort()).toEqual(['account-member', 'creator', 'hq-admin']);
    expect(result.items.find((item) => item.id === 'account-member')?.accountScope.lineAccountIds).toEqual(['account-a']);
    expect(result.items.find((item) => item.id === 'hq-admin')?.roleBundle).toBe('administrator');
    sqlite.close();
  });
});
