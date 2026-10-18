import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { expireRestaurantHolds } from './restaurant-booking.js';
let sql: SqliteD1;
const now = '2026-10-18T01:00:00.000Z';
beforeEach(() => {
  sql = createTestD1({ now: () => new Date(now) });
  sql.raw.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('org','fixture','fixture'),('other','other','other');
    INSERT INTO rt_stores(id,organization_id,name,code) VALUES('a','org','A','A'),('b','other','B','B');`);
});
afterEach(() => sql.raw.close());
function reservation(id: string, store: string, start: string, end: string, count: number, status='pending', expires: string | null=now) {
  sql.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,hold_expires_at)
    VALUES(?,?,'manual','fixture',?,?,?,?,?)`).run(id,store,count,start,end,status,expires);
}
function slot(id: string, store: string, time: string, count: number) {
  sql.raw.prepare('INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity,reserved_count) VALUES(?,?,?,100,?)')
    .run(id,store,time,count);
}
it('失効した店/重なる時間だけを再計算し、終端同時刻・取消・退店・別組織を保つ', async () => {
  reservation('expire','a','2026-10-18 02:00:00','2026-10-18T03:00:00Z',3);
  reservation('active','a','2026-10-18T02:00:00Z','2026-10-18T03:00:00Z',2,'confirmed',null);
  reservation('cancelled','a','2026-10-18T02:00:00Z','2026-10-18T03:00:00Z',7,'cancelled',null);
  reservation('departed','a','2026-10-18T02:00:00Z','2026-10-18T03:00:00Z',9,'visited',null);
  sql.raw.exec("INSERT INTO rt_seat_visit_marks(id,reservation_id,store_id,kind,marked_at) VALUES('visit','departed','a','visited','2026-10-18T01:50:00Z'); UPDATE rt_reservations SET departed_at='2026-10-18T02:00:00Z' WHERE id='departed'");
  reservation('other','b','2026-10-18T02:00:00Z','2026-10-18T03:00:00Z',4,'pending','2026-10-19T01:00:00Z');
  reservation('other-expired','b','2026-10-18T04:00:00Z','2026-10-18T05:00:00Z',6);
  slot('before','a','2026-10-18T01:30:00Z',88); slot('hit','a','2026-10-18T02:00:00Z',5);
  slot('after','a','2026-10-18T03:00:00Z',77); slot('other','b','2026-10-18T02:00:00Z',4);
  expect(await expireRestaurantHolds(sql.db,now,undefined,'org')).toBe(1);
  expect(sql.raw.prepare('SELECT id,reserved_count FROM rt_inventory_slots ORDER BY id').all()).toEqual([
    {id:'after',reserved_count:0},{id:'before',reserved_count:0},{id:'hit',reserved_count:2},{id:'other',reserved_count:4}]);
  expect(await expireRestaurantHolds(sql.db,now,undefined,'org')).toBe(0);
  expect(sql.raw.prepare("SELECT id,status FROM rt_reservations WHERE store_id='b' ORDER BY id").all()).toEqual([
    {id:'other',status:'pending'},{id:'other-expired',status:'pending'}]);
});
it('在庫保存の障害は失効も戻す。再開/並行でも人数を二重に引かない', async () => {
  reservation('expire','a','2026-10-18T02:00:00Z','2026-10-18T03:00:00Z',3); slot('hit','a','2026-10-18T02:00:00Z',3);
  sql.raw.exec(`CREATE TRIGGER fail_inventory BEFORE UPDATE ON rt_inventory_slots BEGIN SELECT RAISE(ABORT,'fixture'); END`);
  await expect(expireRestaurantHolds(sql.db,now,'a')).rejects.toThrow('fixture');
  expect(sql.raw.prepare('SELECT status FROM rt_reservations').get()).toEqual({status:'pending'});
  sql.raw.exec('DROP TRIGGER fail_inventory');
  expect(await Promise.all([expireRestaurantHolds(sql.db,now,'a'),expireRestaurantHolds(sql.db,now,'a')])).toEqual([1,0]);
  expect(sql.raw.prepare('SELECT reserved_count FROM rt_inventory_slots').get()).toEqual({reserved_count:0});
});
it.each([1000,10000])('%i枠で明示再計算のstore/time索引と別店非更新を確認する（既存triggerの追加更新は残す）', async size => {
  reservation('expire','a','2026-10-18T02:00:00Z','2026-10-18T02:30:00Z',3);
  slot('hit','a','2026-10-18T02:00:00Z',3);
  const insert=sql.raw.prepare('INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity,reserved_count) VALUES(?,\'b\',?,100,1)');
  sql.raw.transaction(() => { for(let n=0;n<size;n++) insert.run(`other-${n}`,new Date(Date.parse(now)+n*1800000).toISOString()); })();
  sql.raw.exec('CREATE TABLE changed_fixture(id TEXT); CREATE TRIGGER count_updates AFTER UPDATE ON rt_inventory_slots BEGIN INSERT INTO changed_fixture VALUES(NEW.id); END;');
  const queries: string[]=[];
  const original=sql.db.prepare.bind(sql.db);
  const db={...sql.db,prepare(query:string){ queries.push(query); return original(query); }} as D1Database;
  expect(await expireRestaurantHolds(db,now,'a')).toBe(1);
  expect(new Set((sql.raw.prepare('SELECT * FROM changed_fixture').all() as {id:string}[]).map(row=>row.id))).toEqual(new Set(['hit']));
  const plan=sql.raw.prepare('EXPLAIN QUERY PLAN '+queries.find(q=>q.startsWith('UPDATE rt_inventory_slots'))!).all('a','a',null,null,now,now);
  expect(JSON.stringify(plan)).toContain('idx_rt_inventory_store_time');
  expect(JSON.stringify(plan)).not.toMatch(/SCAN rt_inventory_slots/);
});
