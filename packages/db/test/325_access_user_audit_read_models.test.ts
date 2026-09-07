import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listAccessUsers,
  listAuditEvents,
  recordAuditEvent,
} from '../src/access-audit.js';
import { asD1 } from './d1-test-helper.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
let sqlite: Database.Database;
let db: D1Database;

function addAccount(id: string) {
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run(id, `channel-${id}`, id, TENANT);
}

function addStaff(input: {
  id: string;
  role?: 'owner' | 'admin' | 'staff';
  accessLevel?: 'full' | 'read_only';
  active?: number;
  inviteStatus?: string;
  inviteExpiresAt?: string | null;
  totp?: boolean;
  accountId?: string;
}) {
  sqlite.prepare(
    `INSERT INTO staff_members
       (id, name, email, role, api_key, is_active, access_level, permission_keys,
        notification_preferences, invite_status, invite_expires_at, totp_secret_enc,
        totp_enabled_at, account_scope, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, ?, ?, ?, 'accounts', ?)`,
  ).run(
    input.id, input.id, `${input.id}@example.com`, input.role ?? 'staff', `key-${input.id}`,
    input.active ?? 1, input.accessLevel ?? 'full', input.inviteStatus ?? 'active',
    input.inviteExpiresAt ?? null, input.totp ? 'encrypted' : null,
    input.totp ? '2026-09-01T00:00:00.000Z' : null, TENANT,
  );
  if (input.accountId) {
    sqlite.prepare(
      `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES (?, ?, ?)`,
    ).run(input.id, input.accountId, '2026-09-01T00:00:00.000Z');
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
  addAccount('account-a');
  addAccount('account-b');
});

describe('V6 login user read model', () => {
  it('calculates scoped KPI, role count, last login and last business action from real rows', async () => {
    addStaff({ id: 'owner-a', role: 'owner', totp: true, accountId: 'account-a' });
    addStaff({ id: 'old-a', accountId: 'account-a' });
    addStaff({
      id: 'invite-a', active: 0, inviteStatus: 'pending_email',
      inviteExpiresAt: '2026-10-01T00:00:00.000Z', accountId: 'account-a',
    });
    addStaff({ id: 'hidden-b', accountId: 'account-b' });
    sqlite.prepare(
      `INSERT INTO login_audit (id, admin_user_id, action, result, created_at)
       VALUES ('login-old', 'old-a', 'login', 'ok', '2026-01-01T00:00:00.000Z')`,
    ).run();
    await recordAuditEvent(db, {
      id: 'event-action', tenantId: TENANT, lineAccountId: 'account-a', category: 'business',
      actorPrincipalId: 'owner-a', action: 'broadcast.send', result: 'success',
      createdAt: '2026-09-02T00:00:00.000Z',
    });

    const result = await listAccessUsers(db, {
      tenantId: TENANT, allowedLineAccountIds: ['account-a'], lineAccountId: 'account-a',
      now: '2026-09-07T00:00:00.000Z', limit: 20,
    });

    expect(result.items.map((item) => item.id)).toEqual(expect.arrayContaining(['owner-a', 'old-a', 'invite-a']));
    expect(result.items.map((item) => item.id)).not.toContain('hidden-b');
    expect(result.items.find((item) => item.id === 'owner-a')).toMatchObject({
      roleBundle: 'administrator', mfaEnabled: true, lastActionAt: '2026-09-02T00:00:00.000Z', policyVersion: 1,
    });
    expect(result.summary).toMatchObject({
      active: 2, invited: 1, unused90Days: 1, mfaEnabled: 1, mfaRate: 50,
      roleCounts: { administrator: 1, operations: 2 },
    });
  });

  it('keeps zero active users and unknown MFA rate distinct from zero percent', async () => {
    addStaff({ id: 'invite-a', active: 0, inviteStatus: 'pending_line', accountId: 'account-a' });
    const result = await listAccessUsers(db, {
      tenantId: TENANT, allowedLineAccountIds: ['account-a'], lineAccountId: 'account-a',
      now: '2026-09-07T00:00:00.000Z',
    });
    expect(result.summary).toMatchObject({ active: 0, invited: 1, mfaRate: null });
  });
});

describe('common audit read model', () => {
  it('sanitizes sensitive before/after fields and enforces account scope', async () => {
    addStaff({ id: 'owner-a', role: 'owner', accountId: 'account-a' });
    await recordAuditEvent(db, {
      id: 'event-a', tenantId: TENANT, lineAccountId: 'account-a', category: 'business',
      actorPrincipalId: 'owner-a', actorRole: 'administrator', action: 'broadcast.send',
      targetKind: 'broadcast', targetId: 'broadcast-1', result: 'success',
      before: { status: 'draft', email: 'customer@example.com', note: 'contact customer@example.com', nested: { token: 'secret', count: 1 } },
      after: { status: 'sent', customerPhone: '09000000000', note: 'call 090-0000-0000' },
      ipPrefix: '203.0.113.***', createdAt: '2026-09-06T00:00:00.000Z',
    });
    await recordAuditEvent(db, {
      id: 'event-b', tenantId: TENANT, lineAccountId: 'account-b', category: 'business',
      action: 'broadcast.send', result: 'success', createdAt: '2026-09-06T01:00:00.000Z',
    });
    await recordAuditEvent(db, {
      id: 'event-unscoped', tenantId: TENANT, category: 'business',
      action: 'settings.update', result: 'success', createdAt: '2026-09-06T02:00:00.000Z',
    });

    const result = await listAuditEvents(db, {
      tenantId: TENANT, allowedLineAccountIds: ['account-a'], now: '2026-09-07T00:00:00.000Z',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'event-a',
      before: { status: 'draft', note: 'contact [masked-email]', nested: { count: 1 } },
      after: { status: 'sent', note: 'call [masked-phone]' },
      ipPrefix: '203.0.113.***',
    });
    expect(JSON.stringify(result.items[0])).not.toContain('customer@example.com');
    expect(JSON.stringify(result.items[0])).not.toContain('09000000000');
    expect(JSON.stringify(result.items[0])).not.toContain('secret');
    expect(result.summary).toMatchObject({ total: 1, sent: 1 });
  });
});
