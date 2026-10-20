import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processEventWaitlistPromotionJobs, promoteEventWaitlist } from './event-waitlist.js';
import { type EventWaitlistOfferSender } from './event-waitlist-sender.js';

let fixture: SqliteD1;
const now = new Date('2026-10-11T00:00:00.000Z');
const sender = vi.fn<EventWaitlistOfferSender>();
beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  sender.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('外部通信は禁止'); }));
  fixture.raw.exec(`
    INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('a','a','人工の店','fake','fake');
    INSERT INTO friends (id,line_user_id,display_name,line_account_id)
      VALUES ('f1','Uf1','人工の友だち1','a'),('f2','Uf2','人工の友だち2','a');
    INSERT INTO events (id,line_account_id,name,target_type) VALUES ('e','a','人工イベント','single');
    INSERT INTO event_slots (id,event_id,starts_at,ends_at,capacity)
      VALUES ('s','e','2099-01-01T00:00:00.000Z','2099-01-01T01:00:00.000Z',1);
    INSERT INTO event_waitlist (id,line_account_id,event_id,slot_id,friend_id,identity_key,status,created_at,updated_at)
      VALUES ('w1','a','e','s','f1','f1','waiting','2026-10-01','2026-10-01'),
             ('w2','a','e','s','f2','f2','waiting','2026-10-02','2026-10-02');
  `);
});
afterEach(() => { fixture.raw.close(); vi.unstubAllGlobals(); });

it('EV-C01: 通知台帳保存の失敗は席保留と版上げも取り消す', async () => {
  fixture.raw.exec(`CREATE TRIGGER crash_outbox BEFORE INSERT ON notification_instances
    BEGIN SELECT RAISE(ABORT,'injected outbox crash'); END;`);
  await expect(promoteEventWaitlist(fixture.db, { occurrenceId:'s',lineAccountId:'a',now,sender }))
    .rejects.toThrow('injected outbox crash');
  expect(fixture.raw.prepare("SELECT status FROM event_waitlist WHERE id='w1'").get()).toEqual({status:'waiting'});
  expect(fixture.raw.prepare("SELECT version FROM event_slots WHERE id='s'").get()).toEqual({version:1});
  expect(sender).not.toHaveBeenCalled();
  fixture.raw.exec('DROP TRIGGER crash_outbox');
  await promoteEventWaitlist(fixture.db, { occurrenceId:'s',lineAccountId:'a',now,sender });
  expect(sender).toHaveBeenCalledTimes(1);
});

it('EV-C01: 二つの回収が同時に動いても同じ案内は一度だけ', async () => {
  await promoteEventWaitlist(fixture.db, { occurrenceId:'s',lineAccountId:'a',now,sender });
  // 送信前に止まったsnapshotだけを人工的に再現する。
  fixture.raw.exec("UPDATE notification_deliveries SET status='pending',attempts=0; UPDATE event_waitlist SET notified_at=NULL WHERE id='w1'");
  sender.mockClear();
  await Promise.all([
    processEventWaitlistPromotionJobs(fixture.db, {now,sender}),
    processEventWaitlistPromotionJobs(fixture.db, {now,sender}),
  ]);
  expect(sender).toHaveBeenCalledTimes(1);
});

it('EV-C02: 次job保存の失敗は失効も戻し、再開すると次の人へ進む', async () => {
  fixture.raw.exec(`UPDATE event_waitlist SET status='offered',offered_at='2026-10-01',
    offer_expires_at='2026-10-02',offer_token_hash='hash-old',notified_at='2026-10-01' WHERE id='w1';
    CREATE TRIGGER crash_job BEFORE INSERT ON event_waitlist_promotion_jobs
      BEGIN SELECT RAISE(ABORT,'injected next job crash'); END;`);
  await expect(processEventWaitlistPromotionJobs(fixture.db,{now,sender})).rejects.toThrow('injected next job crash');
  expect(fixture.raw.prepare("SELECT status FROM event_waitlist WHERE id='w1'").get()).toEqual({status:'offered'});
  expect(fixture.raw.prepare("SELECT version FROM event_slots WHERE id='s'").get()).toEqual({version:1});
  fixture.raw.exec('DROP TRIGGER crash_job');
  await processEventWaitlistPromotionJobs(fixture.db,{now,sender});
  await processEventWaitlistPromotionJobs(fixture.db,{now,sender});
  expect(sender).toHaveBeenCalledTimes(1);
  expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM event_waitlist_promotion_jobs').get()).toEqual({n:1});
});
