import { afterEach, beforeEach, expect, it } from 'vitest';
import type { IndustryStyle } from '@line-crm/shared';
import { createStyleScheduleFixture } from '../test-utils/style-schedule-fixture.js';
import { styleSchedule } from './style-schedule.js';
import { styleSnapshot } from './style-analytics.js';

let fixture: ReturnType<typeof createStyleScheduleFixture>;
beforeEach(() => { fixture = createStyleScheduleFixture(); });
afterEach(() => fixture?.raw.close());
const snapshot = (style: IndustryStyle) => ({ style, asOf: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', range: 'today' as const, from: '2026-11-01T00:00:00+09:00', to: '2026-11-02T00:00:00+09:00' });
const load = (style: IndustryStyle = 'restaurant', axis?: string) => styleSchedule(fixture.db, 'a', snapshot(style), { display: 'list', ...(axis ? { axis } : {}) }, undefined, undefined, { kinds: style === 'restaurant' ? ['restaurant'] : style === 'lesson' ? ['event'] : ['booking'] });

it.each([undefined, 'staff', 'table'])('飲食の軸%sでもコースと割り当てた卓を顧客名・担当名から分ける', async axis => {
  const schedule = await load('restaurant', axis);
  expect(schedule.entries[0]).toMatchObject({ title: '季節のコース', tableNames: ['窓側2人卓', '奥の4人卓'], booking: { name: '顧客 花子' } });
  expect(schedule.availability.resources.map(table => table.name)).not.toContain('奥の4人卓');
});

it.each(['salon', 'consult', 'lesson'] as const)('%sでも顧客名をメニュー名に代用しない', async style => {
  const schedule = await load(style);
  const entry = schedule.entries.find(entry => entry.booking);
  expect(entry?.title).toBe(style === 'lesson' ? '朝のヨガ' : '相談メニュー');
  expect(entry?.booking?.name).toBe('顧客 花子');
});

it('複数アカウントで共有するイベントの予約と件数を、申し込んだアカウントに残す', async () => {
  fixture.raw.exec(`UPDATE events SET target_type='multi-account-dedup',account_ids='["a","b"]' WHERE id='event';
    INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('fb','Ub','b','顧客 洋子');
    INSERT INTO event_bookings(id,event_id,slot_id,line_account_id,friend_id,status,requested_at) VALUES('shared-booking','event','slot','b','fb','confirmed','2026-10-30T00:00:00Z');`);
  const summary = await styleSnapshot(fixture.db, 'b', 'lesson', { date: '2026-11-01' }, undefined, Date.parse('2026-11-01T00:00:00Z'), { kinds: ['event'] });
  expect(summary.metrics.bookings.value).toBe(1);
  const schedule = await styleSchedule(fixture.db, 'b', snapshot('lesson'), { display: 'list' }, undefined, undefined, { kinds: ['event'] });
  expect(schedule.entries).toHaveLength(1);
  expect(schedule.entries[0]).toMatchObject({ title: '朝のヨガ', booking: { id: 'shared-booking', name: '顧客 洋子' } });
});

it('昔の単独卓の割り当ても読み、未配席には担当名を入れない', async () => {
  fixture.raw.exec("DELETE FROM rt_reservation_table_links WHERE reservation_id='r'");
  expect((await load()).entries[0]).toMatchObject({ tableNames: ['窓側2人卓'] });
  fixture.raw.exec("UPDATE rt_reservations SET table_id=NULL,course_id=NULL WHERE id='r'");
  expect((await load()).entries[0]).toMatchObject({ title: '席のみ', tableNames: [] });
});

it.each(['other', 'foreign'])('%sの店舗の卓・コースが誤って結ばれても名前を返さない', async scope => {
  const table = scope === 'other' ? 't3' : 'foreign-table';
  const course = scope === 'other' ? 'other-course' : 'foreign-course';
  fixture.raw.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='r'");
  fixture.raw.prepare("UPDATE rt_reservations SET table_id=?,course_id=? WHERE id='r'").run(table, course);
  fixture.raw.exec("DELETE FROM rt_reservation_table_links WHERE reservation_id='r'");
  fixture.raw.prepare("INSERT INTO rt_reservation_table_links(reservation_id,table_id) VALUES('r',?)").run(table);
  const schedule = await load();
  expect(schedule.entries[0]).toMatchObject({ title: '—', tableNames: [] });
  expect(JSON.stringify(schedule.entries[0])).not.toMatch(/別店|別店舗/);
});
