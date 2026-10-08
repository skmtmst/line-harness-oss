import { describe, expect, it } from 'vitest';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
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
