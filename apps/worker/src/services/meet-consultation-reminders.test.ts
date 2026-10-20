import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { BookingExternalCircuits } from '../features/booking/booking-external-circuits.js';
import { describe, expect, it, vi } from 'vitest';
import {
  calculateMeetReminderSchedule,
  processDueMeetConsultationReminders,
  renderMeetReminderText,
} from './meet-consultation-reminders.js';

describe('calculateMeetReminderSchedule', () => {
  it('schedules the previous day and one hour before', () => {
    const now = new Date('2026-08-08T00:00:00.000Z');
    expect(calculateMeetReminderSchedule('2026-08-10T10:00:00.000Z', now)).toEqual([
      { kind: 'day_before', scheduledAt: '2026-08-09T10:00:00.000Z' },
      { kind: 'hour_before', scheduledAt: '2026-08-10T09:00:00.000Z' },
    ]);
  });

  it('sends the day-before reminder immediately when confirmed within 24 hours', () => {
    const now = new Date('2026-08-08T00:00:00.000Z');
    expect(calculateMeetReminderSchedule('2026-08-08T12:00:00.000Z', now)).toEqual([
      { kind: 'day_before', scheduledAt: '2026-08-08T00:00:00.000Z' },
      { kind: 'hour_before', scheduledAt: '2026-08-08T11:00:00.000Z' },
    ]);
  });

  it('does not send two messages together when confirmed within one hour', () => {
    const now = new Date('2026-08-08T00:00:00.000Z');
    expect(calculateMeetReminderSchedule('2026-08-08T00:30:00.000Z', now)).toEqual([
      { kind: 'hour_before', scheduledAt: '2026-08-08T00:00:00.000Z' },
    ]);
  });
});

describe('renderMeetReminderText', () => {
  it('renders the JST date and Meet URL', () => {
    const text = renderMeetReminderText(
      'hour_before',
      '2026-08-09T01:00:00.000Z',
      'https://meet.google.com/abc-defg-hij',
    );
    expect(text).toContain('8月9日（日）10:00');
    expect(text).toContain('開始約1時間前');
    expect(text).toContain('https://meet.google.com/abc-defg-hij');
  });
});

describe('processDueMeetConsultationReminders', () => {
  it('遮断中は送信0・試行数0を保ち、再開後も同じ予定を1回だけ送る', async () => {
    const {db,raw}=createTestD1();
    try {
      raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','A','fixture-token','fake');
        INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f','U1','a',1);
        INSERT INTO meet_consultations(id,external_event_id,friend_id,title,starts_at,ends_at,meet_url,status)
          VALUES('c','event','f','Consultation','2030-01-02T01:00:00Z','2030-01-02T02:00:00Z','https://meet.google.com/abc-defg-hij','confirmed');
        INSERT INTO meet_consultation_notification_runs(id,consultation_id,kind,scheduled_at)
          VALUES('6db37bc2-f0c4-4fa8-baa6-5ec7069e1165','c','hour_before','2030-01-02T00:00:00Z');`);
      const base=Date.parse('2030-01-02T00:00:00Z'),circuit=new BookingExternalCircuits(db);
      const scope={accountId:'a',storeId:'a',destination:'line',connectionId:'a'};
      for(let n=0;n<5;n++){const admission=await circuit.acquire(scope,base);if(admission.allowed)await circuit.settle(admission.lease,'failure',base);}
      const dispatch=vi.fn(async()=>new Response('{}',{status:200}));
      const options={now:new Date(base),proxyBaseUrl:'https://proxy.example.com',proxyDispatch:dispatch};
      for(let n=0;n<4;n++)expect(await processDueMeetConsultationReminders(db,{...options,now:new Date(base+n*1000)})).toEqual({sent:0,failed:0});
      expect(dispatch).not.toHaveBeenCalled();
      expect(raw.prepare('SELECT status,retry_count FROM meet_consultation_notification_runs').get()).toEqual({status:'pending',retry_count:0});
      expect(await processDueMeetConsultationReminders(db,{...options,now:new Date(base+31_000)})).toEqual({sent:1,failed:0});
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {raw.close();}
  });
  it.each([false,true])('Harness送信後の保存障害=%sでも2回目を送らない', async (failResultSave) => {
    const {db,raw}=createTestD1();
    try {
      raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','A','channel-token','fake');
        INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('friend-1','U00000000000000000000000000000000','a',1);
        INSERT INTO meet_consultations(id,external_event_id,friend_id,title,starts_at,ends_at,meet_url,status)
          VALUES('consultation-1','google-event','friend-1','個別相談','2026-08-09T01:00:00.000Z','2026-08-09T02:00:00.000Z','https://meet.google.com/abc-defg-hij','confirmed');
        INSERT INTO meet_consultation_notification_runs(id,consultation_id,kind,scheduled_at)
          VALUES('6db37bc2-f0c4-4fa8-baa6-5ec7069e1165','consultation-1','hour_before','2026-08-09T00:00:00.000Z');`);
      const dispatch=vi.fn(async(request:Request)=>{
        expect(request.url).toBe('https://proxy.example.com/line-api/v2/bot/message/push');
        expect(request.headers.get('x-line-retry-key')).toBe('6db37bc2-f0c4-4fa8-baa6-5ec7069e1165');
        expect(request.headers.has('X-Line-Harness-Source')).toBe(false);
        return new Response('{}',{status:200});
      });
      const options={now:new Date('2026-08-09T00:00:00.000Z'),proxyBaseUrl:'https://proxy.example.com',proxyDispatch:dispatch};
      if(failResultSave)raw.exec(`CREATE TRIGGER stop_result BEFORE UPDATE ON meet_consultation_notification_runs
        WHEN NEW.status='sent' BEGIN SELECT RAISE(ABORT,'fixture'); END`);
      expect(await processDueMeetConsultationReminders(db,options)).toEqual(failResultSave?{sent:0,failed:1}:{sent:1,failed:0});
      if(failResultSave)raw.exec('DROP TRIGGER stop_result');
      expect(await processDueMeetConsultationReminders(db,options)).toEqual({sent:0,failed:0});
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(raw.prepare('SELECT status FROM meet_consultation_notification_runs').get()).toEqual({status:failResultSave?'failed':'sent'});
      expect(raw.prepare("SELECT status FROM workflow_steps WHERE process_kind='booking_line_delivery'").get())
        .toEqual({status:failResultSave?'unknown':'succeeded'});
    }finally{raw.close();}
  });

  it('取消ずみの相談は送らず、予定を止める (送信直前の再確認)', async () => {
    const updates: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first() {
                if (sql.includes('FROM meet_consultations')) return { status: 'cancelled' };
                return null;
              },
              async all() {
                if (!sql.includes('FROM meet_consultation_notification_runs r')) return { results: [] };
                return {
                  results: [{
                    id: 'reminder-cancelled-1',
                    consultation_id: 'consultation-9',
                    kind: 'hour_before',
                    retry_count: 0,
                    title: 'AI導入 個別相談',
                    starts_at: '2026-08-09T01:00:00.000Z',
                    meet_url: 'https://meet.google.com/abc-defg-hij',
                    line_user_id: 'U00000000000000000000000000000000',
                    channel_access_token: 'channel-token',
                    snapshot_booking_id: null,
                    snapshot_booking_version: null,
                    snapshot_friend_id: 'friend-1',
                  }],
                };
              },
              async run() {
                updates.push(args);
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const dispatch = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await processDueMeetConsultationReminders(db, {
      now: new Date('2026-08-09T00:00:00.000Z'),
      proxyBaseUrl: 'https://proxy.example.com',
      proxyDispatch: dispatch,
    });

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(updates).toContainEqual([
      '2026-08-09T00:00:00.000Z',
      'reminder-cancelled-1',
      'consultation-9',
      0,
      null,
      null,
      null,
      null,
      '2026-08-09T01:00:00.000Z',
      'friend-1',
    ]);
  });
});
