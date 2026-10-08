import { asD1 } from '../test-utils/d1-atomic.js';
import { describe, expect, it } from 'vitest';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import { getPendingReminderDeliveries, setFriendFieldValue, setFriendFieldValuesBulk, setFriendFieldValuesForFriend, claimReminderDeliveryRun } from '@line-crm/db';
import { processFriendFieldReminders } from './friend-field-reminders.js';

describe('W7 one-time future date enrollment', () => {
  it('registers the goal before a three-day advance step is due; rejects invalid/past dates and deduplicates', async () => {
    const { db, raw } = createTestD1({ foreignKeys: true });
    try {
      raw.prepare(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
        VALUES ('a','channel','a','token','secret')`).run();
      raw.prepare(`INSERT INTO friend_fields(id,name,field_key,type) VALUES ('date','更新日','renewal','date')`).run();
      raw.prepare(`INSERT INTO reminders(id,name,line_account_id,trigger_type,trigger_field_id,repeat_yearly)
        VALUES ('r','更新案内','a','friend_field','date',0)`).run();
      raw.prepare(`INSERT INTO reminder_steps(id,reminder_id,offset_minutes,message_type,message_content)
        VALUES ('step','r',-4320,'text','3日前です')`).run();
      for (const [id, date] of [['future','2026-05-03'],['past','2026-04-29'],['invalid','2026-02-30']]) {
        insertFriend(raw, id, { line_account_id: 'a' });
        raw.prepare(`INSERT INTO friend_field_values(friend_id,field_id,value) VALUES (?,'date',?)`).run(id,date);
      }
      const now = new Date('2026-04-30T00:05:00+09:00');
      expect(await processFriendFieldReminders(db, now)).toMatchObject({ enrolled: 1, skipped: 2 });
      expect(raw.prepare(`SELECT friend_id,target_date,status FROM friend_reminders`).all()).toEqual([
        { friend_id: 'future', target_date: '2026-05-03T00:00:00+09:00', status: 'active' },
      ]);
      expect(await processFriendFieldReminders(db, now)).toMatchObject({ enrolled: 0 });
      expect(raw.prepare(`SELECT COUNT(*) AS n FROM friend_reminders`).get()).toEqual({ n: 1 });
    } finally { raw.close(); }
  });
});

describe('W7 date edits reconcile unsent schedules only', () => {
  it.each(['scan', 'single', 'bulk', 'multiple'].flatMap(mode => ['2026-05-10', '', null].map(newValue => ({ mode, newValue }))))('moves or cancels via $mode to $newValue while preserving version and history', async ({ mode, newValue }) => {
    const { db, raw } = createTestD1({ foreignKeys: true });
    try {
      raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','channel','a','token','secret');
        INSERT INTO friend_fields(id,name,field_key,type) VALUES ('date','更新日','renewal','date');
        INSERT INTO reminders(id,name,line_account_id,trigger_type,trigger_field_id,repeat_yearly) VALUES ('r','更新案内','a','friend_field','date',0);
        INSERT INTO reminder_steps(id,reminder_id,offset_minutes,message_type,message_content) VALUES ('sent','r',-4320,'text','送信済み'),('unsent','r',-1440,'text','公開時の本文');`);
      raw.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('b','channel-b','b','token','secret')");
      for (const id of ['active','cancelled','completed','other']) {
        insertFriend(raw, id, { line_account_id: id === 'other' ? 'b' : 'a' });
        raw.prepare(`INSERT INTO friend_field_values(friend_id,field_id,value) VALUES (?,'date','2026-05-03')`).run(id);
      }
      await processFriendFieldReminders(db, new Date('2026-04-30T00:05:00+09:00'));
      const rows = raw.prepare('SELECT * FROM friend_reminders').all() as Array<{ id: string; friend_id: string; reminder_version_id: string; target_date: string; status: string }>;
      expect(rows).toHaveLength(3);
      const enrollment = rows.find(row => row.friend_id === 'active')!;
      raw.prepare("UPDATE friend_reminders SET status='cancelled' WHERE friend_id='cancelled'").run();
      raw.prepare("UPDATE friend_reminders SET status='completed' WHERE friend_id='completed'").run();
      raw.prepare(`INSERT INTO friend_reminder_deliveries(id,friend_reminder_id,reminder_step_id) VALUES ('sent-history',?,'sent')`).run(enrollment.id);
      for (const [id,status,step] of [['done','succeeded','sent'],['waiting','queued','unsent'],['old-cancel','cancelled','unsent'],['claimed','claimed','unsent'],['retry','retry_wait','unsent']]) {
        raw.prepare(`INSERT INTO reminder_delivery_runs(id,line_account_id,reminder_id,friend_reminder_id,friend_id,reminder_step_id,scheduled_at,idempotency_key,line_retry_key,status,created_at,updated_at)
          VALUES (?,'a','r',?,'active',?,?,?,?,?,'2026-04-30','2026-04-30')`)
          .run(id,enrollment.id,step,id === 'old-cancel' ? '2026-05-01' : id === 'claimed' ? '2026-05-02T01:00:00Z' : id === 'retry' ? '2026-05-02T02:00:00Z' : '2026-05-02',id,`retry-${id}`,status);
      }
      raw.exec(`UPDATE friend_reminders SET template_version_snapshot='{"saved-template":1}' WHERE friend_id='active';
        UPDATE reminder_versions SET status='superseded' WHERE reminder_id='r';
        INSERT INTO reminder_versions(id,reminder_id,version_number,status,settings_snapshot,created_at,updated_at)
          SELECT 'new-version',reminder_id,2,'draft',settings_snapshot,created_at,updated_at FROM reminder_versions WHERE id='reminder-version-legacy-r';
        INSERT INTO reminder_version_steps(id,reminder_version_id,stable_step_id,position,offset_minutes,message_type,message_content,created_at)
          SELECT 'new-'||stable_step_id,'new-version',stable_step_id,position,offset_minutes,message_type,'新版の本文',created_at
          FROM reminder_version_steps WHERE reminder_version_id='reminder-version-legacy-r';
        UPDATE reminder_versions SET status='published' WHERE id='new-version';
        UPDATE reminders SET current_published_version_id='new-version' WHERE id='r';`);
      // 公開版の本文はそのまま。新しい公開版ができても旧登録の版を使い続ける。
      raw.exec("UPDATE reminder_steps SET message_content='新版の本文' WHERE id='unsent'");
      if (mode === 'single') await setFriendFieldValue(db, { friendId: 'active', fieldId: 'date', value: newValue, updatedBy: 'operator' });
      else if (mode === 'bulk') await setFriendFieldValuesBulk(db, { fieldId: 'date', entries: [{ friendId: 'active', value: newValue }], updatedBy: 'operator', now: '2026-04-30' });
      else if (mode === 'multiple') await setFriendFieldValuesForFriend(db, { friendId: 'active', entries: [{ fieldId: 'date', value: newValue }], updatedBy: 'operator', now: '2026-04-30' });
      else if (newValue === null) raw.exec("DELETE FROM friend_field_values WHERE field_id='date'");
      else raw.prepare("UPDATE friend_field_values SET value=? WHERE field_id='date'").run(newValue);
      if (mode !== 'scan') {
        expect(raw.prepare('SELECT status FROM reminder_delivery_runs WHERE id=\'waiting\'').get()).toEqual({ status: 'cancelled' });
      }
      await processFriendFieldReminders(db, new Date('2026-04-30T00:06:00+09:00'));
      const actual = raw.prepare('SELECT * FROM friend_reminders WHERE id=?').get(enrollment.id) as typeof enrollment;
      expect(actual).toMatchObject({ reminder_version_id: enrollment.reminder_version_id, status: 'cancelled', target_date: enrollment.target_date });
      expect(raw.prepare('SELECT id,status FROM reminder_delivery_runs ORDER BY id').all()).toEqual([
        { id: 'claimed', status: 'cancelled' }, { id: 'done', status: 'succeeded' }, { id: 'old-cancel', status: 'cancelled' }, { id: 'retry', status: 'cancelled' }, { id: 'waiting', status: 'cancelled' },
      ]);
      expect(raw.prepare("SELECT * FROM friend_reminder_deliveries WHERE id='sent-history'").get()).toMatchObject({ friend_reminder_id: enrollment.id });
      expect(raw.prepare('SELECT COUNT(*) AS n FROM friend_reminder_deliveries').get()).toEqual({ n: newValue ? 2 : 1 });
      expect(raw.prepare("SELECT friend_id,status FROM friend_reminders WHERE friend_id != 'active' ORDER BY friend_id").all()).toEqual([
        { friend_id: 'cancelled', status: 'cancelled' }, { friend_id: 'completed', status: 'completed' },
      ]);
      const pending = await getPendingReminderDeliveries(db);
      if (newValue) expect(pending).toEqual([expect.objectContaining({ reminder_version_id: enrollment.reminder_version_id, template_version_snapshot: '{"saved-template":1}', target_date: '2026-05-10T00:00:00+09:00', steps: [expect.objectContaining({ id: 'unsent', message_content: '公開時の本文' })] })]);
      else expect(pending).toEqual([]);
      await processFriendFieldReminders(db, new Date('2026-04-30T00:07:00+09:00'));
      expect(raw.prepare('SELECT COUNT(*) AS n FROM friend_reminders').get()).toEqual({ n: newValue ? 4 : 3 });
      if (newValue) {
        await setFriendFieldValue(db, { friendId: 'active', fieldId: 'date', value: '2026-05-03', updatedBy: 'operator' });
        const reopened = (await getPendingReminderDeliveries(db))[0];
        expect(reopened.id).not.toBe(enrollment.id);
        expect(reopened.reminder_version_id).toBe(enrollment.reminder_version_id);
        expect(reopened.steps.map(step => step.id)).toEqual(['unsent']);
        const claimed = await claimReminderDeliveryRun(db, { lineAccountId: 'a', reminderId: 'r', friendReminderId: reopened.id,
          friendId: 'active', reminderStepId: 'unsent', scheduledAt: '2026-05-02', now: '2026-05-02T00:00:00Z',
          leaseExpiresAt: '2026-05-02T00:05:00Z', expectedTargetDate: reopened.target_date });
        expect(claimed?.status).toBe('claimed');
        expect(raw.prepare("SELECT status FROM reminder_delivery_runs WHERE id='waiting'").get()).toEqual({ status: 'cancelled' });
        // 基準日を過ぎても、残っている後日の工程を自動取消しない。
        await processFriendFieldReminders(db, new Date('2026-05-04T00:00:00+09:00'));
        expect(raw.prepare('SELECT status FROM friend_reminders WHERE id=?').get(reopened.id)).toEqual({ status: 'active' });
      }
    } finally { raw.close(); }
  });
});

it('W7 rolls field writes and scheduling back together if cancellation fails', async () => {
  const { raw } = createTestD1({ foreignKeys: true });
  const db = asD1(raw);
  try {
    raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','channel','a','token','secret');
      INSERT INTO friend_fields(id,name,field_key,type) VALUES ('date','更新日','renewal','date');
      INSERT INTO reminders(id,name,line_account_id,trigger_type,trigger_field_id,repeat_yearly) VALUES ('r','更新案内','a','friend_field','date',0);
      INSERT INTO reminder_steps(id,reminder_id,offset_minutes,message_type,message_content) VALUES ('s','r',-1440,'text','元の本文');`);
    insertFriend(raw,'f',{ line_account_id: 'a' });
    await setFriendFieldValue(db,{ friendId:'f',fieldId:'date',value:'2026-05-03',updatedBy:'operator' });
    await processFriendFieldReminders(db,new Date('2026-04-30T00:00:00+09:00'));
    raw.exec("CREATE TEMP TRIGGER reject_cancel BEFORE UPDATE ON friend_reminders BEGIN SELECT RAISE(ABORT,'cancellation unavailable'); END");
    await expect(setFriendFieldValue(db,{ friendId:'f',fieldId:'date',value:'2026-05-10',updatedBy:'operator' })).rejects.toThrow('cancellation unavailable');
    expect(raw.prepare("SELECT value FROM friend_field_values WHERE friend_id='f'").get()).toEqual({ value:'2026-05-03' });
    expect(raw.prepare('SELECT status,target_date FROM friend_reminders').all()).toEqual([{ status:'active',target_date:'2026-05-03T00:00:00+09:00' }]);
  } finally { raw.close(); }
});
