import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { getLoginAudit, recordLoginAudit } from '../src/login-audit.js';

const TENANT = '00000000-0000-4000-8000-000000000001';

describe('legacy login-audit account boundary', () => {
  it('returns only records tagged with the requested account at write time', async () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
      for (const id of ['account-a', 'account-b']) {
        sqlite.prepare(`INSERT INTO line_accounts
          (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
          VALUES (?, ?, ?, 'token', 'secret', ?)`).run(id, `channel-${id}`, id, TENANT);
      }
      sqlite.prepare(`INSERT INTO staff_members (id, name, role, api_key, tenant_id)
        VALUES ('actor', '担当者', 'owner', 'key', ?)`).run(TENANT);
      const db = asD1(sqlite);
      await recordLoginAudit(db, { adminUserId: 'actor', action: 'login' });
      await recordLoginAudit(db, { adminUserId: 'actor', lineAccountId: 'account-a', action: 'view_personal' });
      await recordLoginAudit(db, { adminUserId: 'actor', lineAccountId: 'account-b', action: 'view_personal' });

      const rows = await getLoginAudit(db, { tenantId: TENANT, lineAccountId: 'account-a' });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('view_personal');
      const other = await getLoginAudit(db, { tenantId: TENANT, lineAccountId: 'account-b' });
      expect(other).toHaveLength(1);
      expect(other[0].id).not.toBe(rows[0].id);
    } finally {
      sqlite.close();
    }
  });
});
