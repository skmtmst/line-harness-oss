import { afterEach, expect, it, vi } from 'vitest';
import { createTestD1, insertFriend } from '../../test-utils/d1-sqlite.js';
import { processWebinarFollowups } from './webinar-followups.js';

vi.mock('../../services/feature-enforcement.js', () => ({ featureJobCanRun: async () => true }));
vi.mock('@line-crm/db', async () => ({
  ...await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db'),
  isOperationCapabilityStopped: async () => false,
}));

afterEach(() => vi.useRealTimers());

it.each([
  ['2099-11-01T08:59:59', 1],
  ['2099-11-01T09:00:01', 0],
])('回答時刻 %s をクリック後か判定して追客を %i 件送る', async (submittedAt, count) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2099-11-01T01:00:00Z'));
  const item = createTestD1({ foreignKeys: false });
  try {
    item.raw.exec(`
      INSERT INTO line_accounts(id, channel_id, name, channel_access_token, channel_secret, liff_id)
        VALUES ('a','c','account','fixture','secret','liff');
      INSERT INTO webinars(id, account_id, title, slug, created_at, updated_at)
        VALUES ('w','a','webinar','demo','2099-10-01T00:00:00Z','2099-10-01T00:00:00Z');
      INSERT INTO webinar_followup_configs(webinar_id, enabled_at, stage_enabled_at)
        VALUES ('w','2099-10-01T00:00:00Z','2099-10-01T00:00:00Z');
      INSERT INTO forms(id, name) VALUES ('form','申込');
      INSERT INTO webinar_ctas(id, webinar_id, at_seconds, kind, title, button_label, form_id, created_at, updated_at)
        VALUES ('cta','w',0,'form','申込','開く','form','2099-10-01T00:00:00Z','2099-10-01T00:00:00Z');
      INSERT INTO webinar_viewers(id, webinar_id, friend_id, session_start_at, joined_at, cta_clicked_at)
        VALUES ('viewer','w','friend',0,'2099-11-01T00:00:00Z','2099-11-01T00:00:00Z');
    `);
    insertFriend(item.raw, 'friend', { line_account_id: 'a' });
    item.raw.prepare(`INSERT INTO form_submissions(id, form_id, friend_id, created_at) VALUES ('sub','form','friend',?)`).run(submittedAt);
    const dispatch = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await processWebinarFollowups(item.db, {
      proxyBaseUrl: 'https://proxy.test', defaultAccessToken: 'fixture', defaultLiffId: 'liff', proxyDispatch: dispatch,
    });
    expect(result, JSON.stringify({ rows: item.raw.prepare('SELECT status, last_error FROM webinar_followups').all(), calls: dispatch.mock.calls.length })).toEqual({ sent: count, failed: 0 });
    expect(dispatch).toHaveBeenCalledTimes(count);
  } finally {
    item.raw.close();
  }
});

it('有効化前の回答を除き、最初の回答からの経過時間で相談案内を送る', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2099-11-01T00:45:00Z'));
  const item = createTestD1({ foreignKeys: false });
  try {
    item.raw.exec(`
      INSERT INTO line_accounts(id, channel_id, name, channel_access_token, channel_secret, liff_id)
        VALUES ('a','c','account','fixture','secret','liff');
      INSERT INTO webinars(id, account_id, title, slug, created_at, updated_at)
        VALUES ('w','a','webinar','demo','2099-10-01T00:00:00Z','2099-10-01T00:00:00Z');
      INSERT INTO webinar_followup_configs(webinar_id, enabled_at, stage_enabled_at, booking_menu_id, booking_url)
        VALUES ('w','2099-11-01T00:00:00Z','2099-11-01T00:00:00Z','menu','https://example.test/booking');
      INSERT INTO forms(id, name) VALUES ('form','申込');
      INSERT INTO webinar_ctas(id, webinar_id, at_seconds, kind, title, button_label, form_id, created_at, updated_at)
        VALUES ('cta','w',0,'form','申込','開く','form','2099-10-01T00:00:00Z','2099-10-01T00:00:00Z');
    `);
    insertFriend(item.raw, 'early', { line_account_id: 'a' });
    insertFriend(item.raw, 'due', { line_account_id: 'a' });
    item.raw.exec(`INSERT INTO form_submissions(id, form_id, friend_id, created_at) VALUES
      ('early','form','early','2099-11-01T08:59:59'),
      ('due-first','form','due','2099-11-01T09:10:00'),
      ('due-later','form','due','2099-11-01 00:20:00')`);
    const dispatch = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await processWebinarFollowups(item.db, {
      proxyBaseUrl: 'https://proxy.test', defaultAccessToken: 'fixture', defaultLiffId: 'liff', proxyDispatch: dispatch,
    });
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(item.raw.prepare('SELECT friend_id FROM webinar_journey_followups').all()).toEqual([{ friend_id: 'due' }]);
    expect(dispatch).toHaveBeenCalledOnce();
  } finally {
    item.raw.close();
  }
});

it('有効化前の回答を未視聴者への案内停止に使わない', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2099-11-01T01:00:00Z'));
  const item = createTestD1({ foreignKeys: false });
  try {
    item.raw.exec(`
      INSERT INTO line_accounts(id, channel_id, name, channel_access_token, channel_secret, liff_id)
        VALUES ('a','c','account','fixture','secret','liff');
      INSERT INTO webinars(id, account_id, title, slug, created_at, updated_at)
        VALUES ('w','a','webinar','demo','2099-10-01T00:00:00Z','2099-10-01T00:00:00Z');
      INSERT INTO webinar_followup_configs(webinar_id, enabled_at, stage_enabled_at)
        VALUES ('w','2099-11-01T00:00:00Z','2099-11-01T00:00:00Z');
      INSERT INTO forms(id, name) VALUES ('form','申込');
      INSERT INTO webinar_ctas(id, webinar_id, at_seconds, kind, title, button_label, form_id, created_at, updated_at)
        VALUES ('cta','w',0,'form','申込','開く','form','2099-10-01T00:00:00Z','2099-10-01T00:00:00Z');
    `);
    insertFriend(item.raw, 'friend', { line_account_id: 'a' });
    item.raw.prepare(`INSERT INTO webinar_registrations(id, webinar_id, friend_id, session_start_at, created_at)
      VALUES ('reg','w','friend',?,'2099-11-01T00:00:00Z')`).run(Date.parse('2099-11-01T00:00:00Z') / 1000);
    item.raw.exec(`INSERT INTO form_submissions(id, form_id, friend_id, created_at)
      VALUES ('early','form','friend','2099-11-01T08:59:59')`);
    const dispatch = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await processWebinarFollowups(item.db, {
      proxyBaseUrl: 'https://proxy.test', defaultAccessToken: 'fixture', defaultLiffId: 'liff', proxyDispatch: dispatch,
    });
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(item.raw.prepare('SELECT kind FROM webinar_journey_followups').all()).toEqual([{ kind: 'registered_no_show' }]);
  } finally {
    item.raw.close();
  }
});
