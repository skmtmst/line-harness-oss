// F-14 すること「担当へ知らせる」＋ F-15 下書きのまま1人で試す。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createNotificationRule, updateNotificationRule } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { runAutomationTest } from './automation-definitions.js';
import { automationRevisionToken, updateAutomationDraft } from './automation-drafts.js';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn());
const sendOperationEmail = vi.hoisted(() => vi.fn());
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    pushMessageWithRequestId = pushMessageWithRequestId;
  },
}));
vi.mock('./operation-notifications.js', () => ({ sendOperationEmail }));

function seedBase(raw: Database.Database): void {
  const columns = raw.prepare(`PRAGMA table_info(notification_rules)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'version')) {
    raw.prepare(`ALTER TABLE notification_rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)`).run();
  }
  raw.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_notification_instance_source
      ON notification_instances(line_account_id, definition_id, source_event_type, source_event_id)
      WHERE audience_type = 'operator'
  `).run();
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '店舗1')`).run();
  raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
  `).run();
  raw.prepare(`
    INSERT INTO staff_members
      (id, name, email, role, api_key, line_user_id, email_verified_at,
       assigned_line_account_id, account_scope, tenant_id)
    VALUES ('owner-1', '統括', 'owner@example.test', 'owner', 'key-owner',
            'U-owner', '2026-09-07T10:00:00+09:00', 'account-1', 'accounts', 'tenant-1')
  `).run();
  raw.prepare(`
    INSERT INTO friends
      (id, line_user_id, display_name, line_account_id, metadata, created_at, updated_at)
    VALUES ('friend-1', 'U-friend-1', '友だち1', 'account-1', '{}', datetime('now'), datetime('now')),
           ('friend-2', 'U-friend-2', '友だち2', 'account-1', '{}', datetime('now'), datetime('now'))
  `).run();
}

async function publishRule(
  db: SqliteD1,
  overrides: { channels?: string[]; active?: boolean } = {},
): Promise<string> {
  const rule = await createNotificationRule(db.db, {
    lineAccountId: 'account-1',
    name: '担当者通知',
    eventType: 'automation_notify_staff',
    conditions: { recipientIds: ['owner-1'], message: 'ルール側の文面' },
    channels: overrides.channels ?? ['dashboard', 'line'],
  });
  if (overrides.active !== false) {
    await updateNotificationRule(db.db, rule.id, 'account-1', { isActive: true });
  }
  return rule.id;
}

/** 公開したことのない下書き定義（status='draft'）を作る。 */
function addDraftDefinition(raw: Database.Database, id: string, actions: unknown[]): string {
  const versionId = `${id}-v1`;
  raw.prepare(`
    INSERT INTO automation_definitions
      (id, line_account_id, name, status, priority, created_at, updated_at)
    VALUES (?, 'account-1', ?, 'draft', 10, datetime('now'), datetime('now'))
  `).run(id, id);
  raw.prepare(`
    INSERT INTO automation_versions
      (id, automation_id, version_number, status, trigger_type, trigger_config,
       condition_config, action_config, created_at, published_at)
    VALUES (?, ?, 1, 'draft', 'message_received', '{}', '{}', ?, datetime('now'), NULL)
  `).run(versionId, id, JSON.stringify(actions));
  raw.prepare(`
    UPDATE automation_definitions
       SET current_draft_version_id = ?, current_published_version_id = NULL
     WHERE id = ?
  `).run(versionId, id);
  return versionId;
}

async function revisionOf(raw: Database.Database, versionId: string): Promise<string> {
  const row = raw.prepare(`
    SELECT trigger_type, trigger_config, condition_config, action_config
      FROM automation_versions WHERE id = ?
  `).get(versionId) as {
    trigger_type: string; trigger_config: string; condition_config: string; action_config: string;
  };
  return automationRevisionToken(versionId, row);
}

function notifyAction(ruleId: string): unknown[] {
  return [{
    id: 'step-1',
    type: 'notify_staff',
    params: { notificationRuleId: ruleId, message: '問い合わせが来ました' },
    onFailure: 'stop',
  }];
}

describe('F-14 担当へ知らせる / F-15 下書きのまま1人で試す', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    pushMessageWithRequestId.mockReset();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'line-request-1' });
    sendOperationEmail.mockReset();
    sendOperationEmail.mockResolvedValue(undefined);
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('下書きのまま1人で試すと、処理のひと言で担当者通知が届く', async () => {
    const ruleId = await publishRule(testDb);
    const versionId = addDraftDefinition(testDb.raw, 'draft-notify', notifyAction(ruleId));
    const result = await runAutomationTest(testDb.db, {
      automationId: 'draft-notify',
      versionId: await revisionOf(testDb.raw, versionId),
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    });
    expect(result.status).toBe('success');
    // 文面はルール側ではなく、この処理のひと言で上書きされる。
    const row = testDb.raw.prepare(`SELECT body FROM notifications`).get() as { body: string };
    expect(row.body).toBe('問い合わせが来ました');
    expect(pushMessageWithRequestId).toHaveBeenCalledTimes(1);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS n FROM notifications`).get()).toEqual({ n: 1 });
  });

  it('止めたルールは送らずに失敗する', async () => {
    const ruleId = await publishRule(testDb, { active: false });
    const versionId = addDraftDefinition(testDb.raw, 'draft-stopped', notifyAction(ruleId));
    const result = await runAutomationTest(testDb.db, {
      automationId: 'draft-stopped',
      versionId: await revisionOf(testDb.raw, versionId),
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    });
    expect(result.status).toBe('failed');
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
  });

  it('メール経路だけのルールは、送達先が無いと送らずに止める', async () => {
    const ruleId = await publishRule(testDb, { channels: ['email'] });
    const versionId = addDraftDefinition(testDb.raw, 'draft-mail', notifyAction(ruleId));
    const result = await runAutomationTest(testDb.db, {
      automationId: 'draft-mail',
      versionId: await revisionOf(testDb.raw, versionId),
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    });
    expect(result.status).toBe('failed');
    expect(sendOperationEmail).not.toHaveBeenCalled();
  });

  it('下書きの保存で、無いルール・空の通知文は受け付けない', async () => {
    const ruleId = await publishRule(testDb);
    const versionId = addDraftDefinition(testDb.raw, 'draft-validate', notifyAction(ruleId));
    const draft = await testDb.db.prepare(
      `SELECT current_draft_version_id AS v FROM automation_definitions WHERE id = 'draft-validate'`,
    ).first<{ v: string }>();
    const token = await revisionOf(testDb.raw, draft!.v);
    const base = {
      id: 'draft-validate',
      lineAccountId: 'account-1',
      expectedDraftVersionId: token,
      name: 'draft-validate',
      eventType: 'message_received',
      triggerConfig: {},
    };
    await expect(updateAutomationDraft(testDb.db, {
      ...base,
      actions: [{ id: 'step-1', type: 'notify_staff', params: { notificationRuleId: 'no-such-rule', message: 'x' } }],
    })).rejects.toMatchObject({ code: 'resource_not_found' });
    await expect(updateAutomationDraft(testDb.db, {
      ...base,
      actions: [{ id: 'step-1', type: 'notify_staff', params: { notificationRuleId: ruleId, message: '  ' } }],
    })).rejects.toMatchObject({ code: 'required' });
  });
});
