import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  archiveSupportMarkAutomationRule,
  createSupportMarkAutomationRule,
  listSupportMarkAutomationRules,
  updateSupportMarkAutomationRule,
} from './support-mark-automation';

function addAccount(raw: Database.Database, id = 'account-1', tenantId = 'tenant-1'): void {
  raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`)
    .run(tenantId, tenantId);
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES (?, ?, ?, '', '', 1, ?)`,
  ).run(id, `channel-${id}`, id, tenantId);
}

function addMark(raw: Database.Database, id: string, accountId = 'account-1', tenantId = 'tenant-1'): void {
  raw.prepare(`INSERT OR IGNORE INTO support_marks (id, name, color) VALUES (?, ?, '#3B82F6')`)
    .run(id, id);
  raw.prepare(
    `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  ).run(id, tenantId, accountId);
}

describe('対応マーク自動変更ルールのV6契約', () => {
  let testDb: SqliteD1;
  const scope = { tenantId: 'tenant-1', lineAccountId: 'account-1' };

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw);
    addAccount(testDb.raw, 'account-2', 'tenant-2');
    addMark(testDb.raw, 'mark-working');
    addMark(testDb.raw, 'mark-done');
    addMark(testDb.raw, 'mark-other', 'account-2', 'tenant-2');
  });

  it('公開版として保存し、変更ごとに版を進め、古い版の更新を拒否する', async () => {
    const created = await createSupportMarkAutomationRule(
      testDb.db, scope, 'mark-working', 'staff-1', {
        name: '担当者が決まったら対応中へ', event: 'staff_assigned', condition: null,
        priority: 100, manualProtectionMinutes: 60, isActive: true,
      },
    );
    expect(created).toMatchObject({
      markId: 'mark-working', event: 'staff_assigned', priority: 100,
      manualProtectionMinutes: 60, version: 1, isActive: true,
    });
    expect(testDb.raw.prepare(`SELECT trigger_type FROM automation_versions`).get())
      .toEqual({ trigger_type: 'support_mark_change' });

    const updated = await updateSupportMarkAutomationRule(
      testDb.db, scope, created!.id, 'staff-2', 1, {
        name: '期限超過で対応中へ', event: 'response_overdue', condition: null,
        priority: 120, manualProtectionMinutes: 30, isActive: false,
      },
    );
    expect(updated).toMatchObject({ version: 2, event: 'response_overdue', isActive: false });
    expect(await updateSupportMarkAutomationRule(
      testDb.db, scope, created!.id, 'staff-2', 1, {
        name: '古い画面', event: 'message_received', condition: null,
        priority: 1, manualProtectionMinutes: 0, isActive: true,
      },
    )).toBe('conflict');
  });

  it('対象マークだけを一覧し、削除は履歴を消さず保管する', async () => {
    const created = await createSupportMarkAutomationRule(
      testDb.db, scope, 'mark-working', 'staff-1', {
        name: '返信で対応中へ', event: 'manual_reply_sent', condition: null,
        priority: 10, manualProtectionMinutes: 0, isActive: true,
      },
    );
    expect(await listSupportMarkAutomationRules(testDb.db, scope, 'mark-done')).toEqual([]);
    expect(await archiveSupportMarkAutomationRule(testDb.db, scope, created!.id, 1))
      .toBe('archived');
    expect(await listSupportMarkAutomationRules(testDb.db, scope, 'mark-working')).toEqual([]);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_versions`).get())
      .toEqual({ count: 1 });
  });

  it('別アカウントのマークにはルールを作成できない', async () => {
    expect(await createSupportMarkAutomationRule(
      testDb.db, scope, 'mark-other', 'staff-1', {
        name: '他店のルール', event: 'message_received', condition: null,
        priority: 0, manualProtectionMinutes: 0, isActive: true,
      },
    )).toBeNull();
  });
});
