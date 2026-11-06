import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getLineAccountScopeEntries, listLineAccountsWithTenantStatus } from '../src/line-accounts.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
let db: D1Database;
beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.exec(`INSERT INTO tenants(id,name,status) VALUES
    ('active-tenant','稼働','active'), ('stopped-tenant','停止','suspended'), ('archived-tenant','保管','archived')`);
  const insert = raw.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret,login_channel_id,tenant_id,is_active,archived_at,display_order)
    VALUES (?,?,?,'','','login-' || ?,?,?,?,?)`);
  for (const [order, [id, tenant, active, archived]] of [
    ['active', 'active-tenant', 1, null],
    ['stopped-account', 'active-tenant', 0, null],
    ['archived-account', 'active-tenant', 0, '2026-10-18'],
    ['stopped-tenant', 'stopped-tenant', 1, null],
    ['archived-tenant', 'archived-tenant', 1, null],
    ['orphan', 'missing-tenant', 1, null],
    ['legacy', null, 1, null],
  ].entries()) {
    // Deliberately emulate one legacy orphan, without relaxing normal fixtures.
    if (tenant === 'missing-tenant') raw.pragma('foreign_keys = OFF');
    insert.run(id, id, id, id, tenant, active, archived, order);
    if (tenant === 'missing-tenant') raw.pragma('foreign_keys = ON');
  }
  db = asD1(raw);
});
afterEach(() => raw.close());

describe('runtime account metadata (F08 DB boundary)', () => {
  it('preserves stopped and archived accounts in the management list and exposes both account and tenant state in one query', async () => {
    const prepare = vi.spyOn(db, 'prepare');
    const rows = await listLineAccountsWithTenantStatus(db);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(rows.map(({ id, is_active, archived_at, tenant_status }) => ({ id, is_active, archived_at, tenant_status }))).toEqual([
      { id: 'active', is_active: 1, archived_at: null, tenant_status: 'active' },
      { id: 'stopped-account', is_active: 0, archived_at: null, tenant_status: 'active' },
      { id: 'archived-account', is_active: 0, archived_at: '2026-10-18', tenant_status: 'active' },
      { id: 'stopped-tenant', is_active: 1, archived_at: null, tenant_status: 'suspended' },
      { id: 'archived-tenant', is_active: 1, archived_at: null, tenant_status: 'archived' },
      { id: 'orphan', is_active: 1, archived_at: null, tenant_status: 'archived' },
      { id: 'legacy', is_active: 1, archived_at: null, tenant_status: 'active' },
    ]);
  });

  it('keeps tenant scope and lifecycle metadata without returning credentials', async () => {
    const rows = await getLineAccountScopeEntries(db, 'active-tenant');
    expect(rows.map(({ id, is_active, archived_at }) => ({ id, is_active, archived_at }))).toEqual([
      { id: 'active', is_active: 1, archived_at: null },
      { id: 'stopped-account', is_active: 0, archived_at: null },
      { id: 'archived-account', is_active: 0, archived_at: '2026-10-18' },
    ]);
    for (const row of rows) {
      expect(row).not.toHaveProperty('channel_access_token');
      expect(row).not.toHaveProperty('channel_secret');
    }
    expect((await getLineAccountScopeEntries(db, DEFAULT_TENANT_ID)).map(row => row.id)).toEqual(['legacy']);
  });
});
