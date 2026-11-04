import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { getLinkClicks, getTrackedLinks } from '../src/tracked-links.js';

it('リンクとクリックの一覧は UTC と JST の記録を実時刻で並べて返す', async () => {
  const raw = new Database(':memory:');
  raw.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  raw.exec(`INSERT INTO tracked_links (id,name,original_url,created_at,updated_at) VALUES
    ('old','old','https://a.example','2026-11-04T19:00:00','2026-11-04T19:00:00'),
    ('new','new','https://b.example','2026-11-04 11:00:00','2026-11-04 11:00:00');
    INSERT INTO link_clicks (id,tracked_link_id,clicked_at) VALUES
    ('old-click','new','2026-11-04T19:00:00'),('new-click','new','2026-11-04 11:00:00');`);
  const db = asD1(raw);
  expect((await getTrackedLinks(db)).map(row => [row.id, row.created_at])).toEqual([
    ['new','2026-11-04T11:00:00Z'], ['old','2026-11-04T19:00:00+09:00'],
  ]);
  expect((await getLinkClicks(db, 'new')).map(row => [row.id, row.clicked_at])).toEqual([
    ['new-click','2026-11-04T11:00:00Z'], ['old-click','2026-11-04T19:00:00+09:00'],
  ]);
  raw.close();
});

it('クリックの期間判定で UTC・JST と期間外の記録を区別する', async () => {
  const { countFunnelStep } = await import('../src/funnels.js');
  const raw = new Database(':memory:');
  raw.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  raw.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','c','店','t','s');
    INSERT INTO friends (id,line_user_id,line_account_id) VALUES ('utc','u1','a'),('jst','u2','a'),('late','u3','a');
    INSERT INTO tracked_links (id,name,original_url) VALUES ('link','リンク','https://a.example');
    INSERT INTO link_clicks (id,tracked_link_id,friend_id,clicked_at) VALUES
    ('c1','link','utc','2026-11-04 10:00:00'),('c2','link','jst','2026-11-04T19:00:00'),
    ('c3','link','late','2026-11-04 12:00:00');`);
  const result = await countFunnelStep(asD1(raw), { id:'s', funnel_id:'f', step_order:1, label:'click', kind:'link_click', match_json:'{"trackedLinkId":"link"}' },
    { lineAccountId:'a', from:'2026-11-04T09:59:59Z', to:'2026-11-04T10:00:01Z' });
  expect(result.sort()).toEqual(['jst','utc']);
  const jstWindow = await countFunnelStep(asD1(raw), { id:'s', funnel_id:'f', step_order:1, label:'click', kind:'link_click', match_json:'{"trackedLinkId":"link"}' },
    { lineAccountId:'a', from:'2026-11-04T19:00:00', to:'2026-11-04T19:00:01' });
  expect(jstWindow.sort()).toEqual(['jst','utc']);
  raw.close();
});

it('リッチメニューの集計は日本時間の境界を UTC と JST のクリックに適用する', async () => {
  const { getRichMenuTapStats } = await import('../src/rich-menus/audience-statistics.js');
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE rich_menu_groups (id TEXT, account_id TEXT);
    CREATE TABLE rich_menu_pages (id TEXT, group_id TEXT);
    CREATE TABLE rich_menu_areas (id TEXT, page_id TEXT, label TEXT, tracked_link_id TEXT);
    CREATE TABLE rich_menu_area_taps (area_id TEXT, group_id TEXT, page_id TEXT, area_label TEXT, tapped_at TEXT);
    CREATE TABLE link_clicks (id TEXT, tracked_link_id TEXT, clicked_at TEXT);
    INSERT INTO rich_menu_groups VALUES ('group','account');
    INSERT INTO rich_menu_pages VALUES ('page','group');
    INSERT INTO rich_menu_areas VALUES ('area','page','リンク','link');
    INSERT INTO link_clicks VALUES ('before','link','2026-11-04 14:59:59'),
      ('utc','link','2026-11-04 15:00:00'),('jst','link','2026-11-05T23:59:59');`);
  const stats = await getRichMenuTapStats(asD1(raw), 'account', '2026-11-05T00:00:00', '2026-11-06T00:00:00');
  expect(stats.total).toBe(2);
  raw.close();
});

it('クリック集計の初回と最終は実時刻で選び、UTC の時差を明示する', async () => {
  const { getTrackedLinkStats } = await import('../src/analytics.js');
  const raw = new Database(':memory:');
  raw.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  raw.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','c','店','t','s');
    INSERT INTO tracked_links (id,name,original_url,line_account_id) VALUES ('link','リンク','https://a.example','a');
    INSERT INTO link_clicks (id,tracked_link_id,clicked_at) VALUES
      ('utc','link','2026-11-04 10:00:00'),('jst','link','2026-11-04T19:30:00');`);
  const rows = await getTrackedLinkStats(asD1(raw), 'a', { from:'2026-11-04T09:00:00Z', to:'2026-11-04T11:00:00Z' });
  expect(rows[0]).toMatchObject({ clicks:2, firstClickedAt:'2026-11-04T10:00:00.000Z', lastClickedAt:'2026-11-04T10:30:00.000Z' });
  raw.close();
});
