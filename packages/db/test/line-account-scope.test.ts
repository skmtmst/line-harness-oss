import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getLineAccountScopeEntries } from '../src/line-accounts.js';
import { asD1 } from './d1-test-helper.js';

describe('LINE account authorization scope query', () => {
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
              'login-id', 'login-secret', 'liff-id', 1, 0, ?, ?)
    `);
    insert.run('default-account', 'default-channel', '既定', DEFAULT_TENANT_ID, 1);
    insert.run('legacy-account', 'legacy-channel', '旧行', null, 2);
    insert.run('tenant-b-account', 'tenant-b-channel', 'B', 'tenant-b', 3);

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
    sqlite.close();
  });
});
