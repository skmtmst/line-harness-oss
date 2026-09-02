import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

describe('177 tenant backfill and unique organization', () => {
  it('3テーブルのNULLを補完し、同じ統括への2つ目の飲食店組織を拒否する', () => {
    const db = new Database(':memory:');
    db.exec(readFileSync(join(packageRoot, 'schema.sql'), 'utf8'));
    db.exec(readFileSync(join(packageRoot, 'migrations', '168_restaurant_test_foundation.sql'), 'utf8'));
    db.exec(readFileSync(join(packageRoot, 'migrations', '176_tenant_foundation.sql'), 'utf8'));

    db.prepare(`INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('line-null', 'channel-null', '店舗LINE', 'token', 'secret', NULL)`).run();
    db.prepare(`INSERT INTO staff_members
      (id, name, role, api_key, tenant_id)
      VALUES ('staff-null', '担当者', 'admin', 'api-key-null', NULL)`).run();
    db.prepare(`INSERT INTO rt_organizations
      (id, account_id, name, tenant_id)
      VALUES ('org-null', 'line-null', '飲食店組織', NULL)`).run();

    db.exec(readFileSync(join(packageRoot, 'migrations', '177_tenant_backfill_and_unique.sql'), 'utf8'));

    for (const table of ['line_accounts', 'staff_members', 'rt_organizations']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id IS NULL`).get())
        .toEqual({ count: 0 });
    }
    expect(db.prepare(`SELECT tenant_id FROM rt_organizations WHERE id = 'org-null'`).get())
      .toEqual({ tenant_id: DEFAULT_TENANT_ID });
    expect(() => db.prepare(`INSERT INTO rt_organizations
      (id, account_id, name, tenant_id)
      VALUES ('org-duplicate', 'line-null', '重複組織', ?)`).run(DEFAULT_TENANT_ID))
      .toThrow(/UNIQUE constraint failed/);
  });
});
