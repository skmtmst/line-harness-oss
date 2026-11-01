import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createStyleScheduleFixture } from '../test-utils/style-schedule-fixture.js';
import { styleSnapshot } from './style-analytics.js';

let fixture: ReturnType<typeof createStyleScheduleFixture>;
beforeEach(() => {
  fixture = createStyleScheduleFixture();
  fixture.raw.exec(`
    INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity,is_active) VALUES
      ('free','store','FREE','空いている卓','table',1,2,1),
      ('closed','store','CLOSED','時間を閉じた卓','table',1,2,1);
    INSERT INTO rt_closures(id,store_id,start_date,end_date,all_day,kind,table_ids_json,periods_json)
      VALUES('closure','store','2026-11-01','2026-11-01',1,'maintenance','["closed"]',
        '[{"startsAt":"2026-10-31T15:00:00Z","endsAt":"2026-11-01T15:00:00Z"}]');
  `);
});
afterEach(() => fixture.raw.close());

async function load(account = 'a', storeId?: string, range = 'today') {
  const snapshot = await styleSnapshot(
    fixture.db, account, 'restaurant', { date: '2026-11-01', range, store_id: storeId },
    undefined, Date.parse('2026-11-01T01:30:00Z'), { kinds: ['restaurant'] },
  );
  const file = process.env.FREE_TABLE_EVIDENCE;
  if (file) {
    const evidence = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    evidence[expect.getState().currentTestName!] = { account, storeId, range, snapshot };
    writeFileSync(file, JSON.stringify(evidence, null, 2));
  }
  return snapshot;
}

it('空席と同じ店舗の有効卓を総数にし、停止卓と他店を含めない', async () => {
  const snapshot = await load('a', 'store');
  expect(snapshot.metrics.freeTables).toMatchObject({ value: 1, totalTables: 3, unit: '卓', status: 'available' });
});

it('店舗未指定でも同じアカウントの卓だけを数え、所属なしの店舗を含めない', async () => {
  expect((await load()).metrics.freeTables).toMatchObject({ value: 1, totalTables: 3 });
});

it('別のアカウントではその店の卓だけを数える', async () => {
  expect((await load('b')).metrics.freeTables).toMatchObject({ value: 1, totalTables: 1 });
});

it('別アカウントの店舗指定へ範囲を広げない', async () => {
  expect((await load('a', 'foreign-store')).metrics.freeTables).toMatchObject({ value: 0, totalTables: 0 });
});

it('一時的に全卓を閉じても対象卓の総数を減らさない', async () => {
  fixture.raw.exec("UPDATE rt_closures SET table_ids_json='[]'");
  expect((await load('a', 'store')).metrics.freeTables).toMatchObject({ value: 0, totalTables: 3 });
});

it('予約を取り消しても有効卓の総数を変えず、元の空席計算を使う', async () => {
  fixture.raw.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='r'");
  expect((await load('a', 'store')).metrics.freeTables).toMatchObject({ value: 2, totalTables: 3, status: 'available' });
});

it('有効卓が0の実測と、総数が届かない旧応答を分けられる', async () => {
  fixture.raw.exec("UPDATE rt_tables SET is_active=0 WHERE store_id='store'");
  expect((await load('a', 'store')).metrics.freeTables).toMatchObject({ value: 0, totalTables: 0 });
});

it.each(['week', 'month'])('期間%sでも現在の卓を重複計上しない', async range => {
  expect((await load('a', 'store', range)).metrics.freeTables).toMatchObject({ value: 1, totalTables: 3 });
});

it('最低標本数未満でも空席の実数を保ち、既存の率だけは抑止する', async () => {
  fixture.raw.exec(`INSERT INTO account_styles(line_account_id,style,settings_json,updated_at)
    VALUES('a','restaurant','{"minimumSample":5}','2026-11-01T00:00:00Z')`);
  const snapshot = await load('a', 'store');
  expect(snapshot.metrics.freeTables).toMatchObject({ value: 1, totalTables: 3, status: 'available' });
  expect(snapshot.metrics.freeTables.denominator).toBeUndefined();
  expect(snapshot.metrics.noShowRate).toMatchObject({ value: null, denominator: 1, status: 'insufficient_sample' });
});
