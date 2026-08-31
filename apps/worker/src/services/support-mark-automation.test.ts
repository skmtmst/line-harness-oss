import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  archiveSupportMarkAutomationRule,
  createSupportMarkAutomationRule,
  listSupportMarkAutomationRules,
  updateSupportMarkAutomationRule,
} from './support-mark-automation';

function addAccount(raw: Database.Database): void {
  raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', '本部')`).run();
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-1', 'channel-1', '本店', '', '', 1, 'tenant-1')`,
  ).run();
}

describe('対応マーク自動変更ルールのV6契約', () => {
  let testDb: SqliteD1;
  let scope: { tenantId: string; lineAccountId: string };

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw);
    const account = testDb.raw.prepare(
      `SELECT tenant_id FROM line_accounts WHERE id = 'account-1'`,
    ).get() as { tenant_id: string };
    scope = { tenantId: account.tenant_id, lineAccountId: 'account-1' };
    testDb.raw.prepare(
      `INSERT OR IGNORE INTO support_marks (id, name, color) VALUES
       ('mark_working', '対応中', '#3B82F6'), ('mark_done', '解決済', '#10B981')`,
    ).run();
    testDb.raw.prepare(
      `INSERT OR REPLACE INTO support_mark_scopes
         (mark_id, tenant_id, line_account_id, created_at)
       VALUES (?, ?, 'account-1', datetime('now')), (?, ?, 'account-1', datetime('now'))`,
    ).run('mark_working', account.tenant_id, 'mark_done', account.tenant_id);
  });

  it('既存のV6オートメーション定義へ公開版として保存し、版を進める', async () => {
    const created = await createSupportMarkAutomationRule(
      testDb.db, scope, 'mark_working', 'staff-1', {
        name: '担当者が決まったら対応中へ', event: 'staff_assigned', condition: null,
        priority: 100, manualProtectionMinutes: 60, isActive: true,
      },
    );
    expect(created).toMatchObject({
      markId: 'mark_working', event: 'staff_assigned', priority: 100,
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

  it('対象マークだけを一覧し、削除は履歴を消さずアーカイブする', async () => {
    const created = await createSupportMarkAutomationRule(
      testDb.db, scope, 'mark_working', 'staff-1', {
        name: '返信で対応中へ', event: 'manual_reply_sent', condition: null,
        priority: 10, manualProtectionMinutes: 0, isActive: true,
      },
    );
    expect(await listSupportMarkAutomationRules(testDb.db, scope, 'mark_done')).toEqual([]);
    expect(await archiveSupportMarkAutomationRule(testDb.db, scope, created!.id, 1))
      .toBe('archived');
    expect(await listSupportMarkAutomationRules(testDb.db, scope, 'mark_working')).toEqual([]);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_versions`).get())
      .toEqual({ count: 1 });
  });
});
