import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationRule, updateNotificationRule } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { dispatchOperatorEvent, sweepOperatorNotifications } from './operator-notification-dispatch.js';

vi.mock('@line-crm/line-sdk', () => ({ LineClient: class {} }));
vi.mock('./operation-notifications.js', () => ({ sendOperationEmail: vi.fn() }));
const env = {} as Parameters<typeof dispatchOperatorEvent>[1];

describe('担当への返事の通知センター', () => {
  let db: SqliteD1;
  beforeEach(() => {
    db = createTestD1();
    const cols = db.raw.prepare('PRAGMA table_info(notification_rules)').all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'version')) db.raw.exec('ALTER TABLE notification_rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    db.raw.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_notification_instance_source ON notification_instances(line_account_id, definition_id, source_event_type, source_event_id) WHERE audience_type = 'operator';
      INSERT INTO tenants(id,name) VALUES ('tenant-1','統括');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,is_active,tenant_id) VALUES ('account-1','channel-1','店舗','token','secret',1,'tenant-1');
      INSERT INTO staff_members(id,name,email,role,api_key,assigned_line_account_id,account_scope,tenant_id,permission_keys)
        VALUES ('owner-1','管理者','owner@example.test','owner','key-owner','account-1','accounts','tenant-1','["/chats"]'), ('staff-2','担当','staff@example.test','staff','key-staff','account-1','accounts','tenant-1','["/chats"]');
      INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES ('owner-1','account-1','2026'),('staff-2','account-1','2026');
      INSERT INTO operators(id,name,email) VALUES ('old-operator','旧担当','old@example.test');
      INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('friend','line-friend','友だち','account-1');
      INSERT INTO messages_log(id,friend_id,direction,message_type,content,line_account_id) VALUES ('msg','friend','incoming','text','本文','account-1');
    `);
  });

  it.each(['legacy', 'specified'] as const)('%s でも通知センターに1行作る', async kind => {
    db.raw.exec(`INSERT INTO chats(id,friend_id,operator_id,assignee_staff_id,created_at,updated_at) VALUES ('chat','friend',${kind === 'legacy' ? "'old-operator'" : 'NULL'},${kind === 'specified' ? "'staff-2'" : 'NULL'},'2026','2026')`);
    const conditions = kind === 'specified' ? { recipientIds: ['owner-1'] } : {};
    const rule = await createNotificationRule(db.db, { lineAccountId: 'account-1', name: '担当への返事', eventType: 'inbox_assigned_reply', conditions, channels: ['dashboard'] });
    await updateNotificationRule(db.db, rule.id, 'account-1', { isActive: true });
    await dispatchOperatorEvent(db.db, env, { lineAccountId: 'account-1', eventType: 'inbox_assigned_reply', sourceEventId: 'msg', executionMode: 'automatic' });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 1 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE channel='in_app' AND status='provider_accepted'").get()).toEqual({ n: kind === 'legacy' ? 2 : 1 });
  });

  it.each(['legacy', 'specified'] as const)('%s の未完了の画面通知を回収する', async kind => {
    db.raw.exec(`INSERT INTO chats(id,friend_id,operator_id,assignee_staff_id,created_at,updated_at) VALUES ('chat','friend',${kind === 'legacy' ? "'old-operator'" : 'NULL'},${kind === 'specified' ? "'staff-2'" : 'NULL'},'2026','2026')`);
    const conditions = kind === 'specified' ? { recipientIds: ['owner-1'] } : {};
    const rule = await createNotificationRule(db.db, { lineAccountId: 'account-1', name: '担当への返事', eventType: 'inbox_assigned_reply', conditions, channels: ['dashboard'] });
    await updateNotificationRule(db.db, rule.id, 'account-1', { isActive: true });
    db.raw.prepare(`INSERT INTO notification_instances(id,line_account_id,audience_type,definition_id,definition_version_id,source_event_type,source_event_id,source_metadata_json,dedupe_key,status,created_at,updated_at) VALUES ('instance','account-1','operator',?,'1','inbox_assigned_reply','msg',?,'dedupe','pending','2000-01-01','2000-01-01')`).run(rule.id, JSON.stringify({ ruleVersion: 1, ruleName: '担当への返事', message: '新しい返事', conditions, channels: ['dashboard'] }));
    db.raw.exec(`INSERT INTO notification_deliveries(id,line_account_id,instance_id,audience_type,recipient_type,recipient_id,channel,idempotency_key,status,retryable,attempts,queued_at,execution_mode,version,updated_at) VALUES ('delivery','account-1','instance','operator','staff','owner-1','in_app','retry','pending',0,0,'2000-01-01','automatic',1,'2000-01-01')`);
    expect(await sweepOperatorNotifications(db.db, env, { lineAccountId: 'account-1' })).toMatchObject({ accepted: 1, excluded: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT status FROM notification_deliveries').get()).toEqual({ status: 'provider_accepted' });
  });
});
