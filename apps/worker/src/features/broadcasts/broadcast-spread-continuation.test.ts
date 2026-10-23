import { afterEach, expect, it, vi } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import {
  BROADCAST_DISPATCH_NOT_BEFORE_PREFIX,
  requestBroadcastStop,
  reserveBroadcastDispatchMinute,
  resumeBroadcastSending,
} from '@line-crm/db/src/broadcasts/index.js';
import { processQueuedBroadcasts } from './broadcast.js';

const wire = vi.hoisted(() => ({ batches: [] as string[][] }));
vi.mock('@line-crm/line-sdk', async original => ({
  ...await original<Record<string, unknown>>(),
  LineClient: class {
    async multicast(ids: string[]) {
      wire.batches.push([...ids]);
      return { requestId: 'synthetic' };
    }
  },
}));
vi.mock('../../services/stealth.js', async original => ({
  ...await original<Record<string, unknown>>(), sleep: async () => {},
}));

const opened: ReturnType<typeof createTestD1>[] = [];
const fallback = {} as import('@line-crm/line-sdk').LineClient;
const start = Date.parse('2026-10-23T00:00:00Z');
afterEach(() => { opened.splice(0).forEach(f => f.raw.close()); wire.batches = []; });

function fixture(recipients = 6_000) {
  const f = createTestD1(); opened.push(f);
  f.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret)
    VALUES('a','合成店舗','a','synthetic','synthetic')`);
  const add = f.raw.prepare(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following)
    VALUES(?,?,'a','合成',1)`);
  f.raw.transaction(() => {
    for (let i = 0; i < recipients; i++) add.run(`f${String(i).padStart(5, '0')}`, `U${i}`);
  })();
  f.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,
    segment_conditions,status,batch_offset,track_links,line_account_id,stealth_spread_minutes)
    VALUES('paced','合成','text','合成配信','segment',?,'sending',0,0,'a',60)`)
    .run(JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }));
  return f;
}

const dispatch = (db: D1Database, now: number) =>
  processQueuedBroadcasts(db, fallback, undefined, { accountId: 'a', now: () => now });

it('6,000宛先/60分は再配達が来ても毎分100人を超えず、全宛先を一度ずつ完了する', async () => {
  const f = fixture();
  expect(await dispatch(f.db, start)).toMatchObject({ acceptedRecipients: 100, hasMore: true, nextDelaySeconds: 60 });
  expect(await dispatch(f.db, start + 1_000)).toMatchObject({ acceptedRecipients: 0, nextDelaySeconds: 59 });
  expect(await dispatch(f.db, start + 59_001)).toMatchObject({ acceptedRecipients: 0, nextDelaySeconds: 1 });
  expect(wire.batches).toHaveLength(1);
  for (let minute = 1; minute < 60; minute++) {
    const result = await dispatch(f.db, start + minute * 60_000);
    expect(result).toMatchObject({
      acceptedRecipients: 100, hasMore: minute < 59, nextDelaySeconds: minute < 59 ? 60 : null,
    });
  }
  expect(wire.batches).toHaveLength(60);
  expect(new Set(wire.batches.flat()).size).toBe(6_000);
  expect(f.raw.prepare("SELECT status,success_count FROM broadcasts WHERE id='paced'").get())
    .toEqual({ status: 'sent', success_count: 6_000 });
}, 15_000);

it('同じ店の通常配信は待機中の時間分散配信に塞がれず、別店へは送らない', async () => {
  const f = fixture();
  // Both broadcasts are ready: the account cursor selects paced first, then ordinary.
  f.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,
    segment_conditions,status,batch_offset,track_links,line_account_id)
    VALUES('z-normal','合成','text','通常配信','segment',?,'sending',0,0,'a')`)
    .run(JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }));
  f.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret)
    VALUES('b','別店','b','synthetic','synthetic');
    INSERT INTO broadcasts(id,title,message_type,message_content,target_type,
      segment_conditions,status,batch_offset,track_links,line_account_id)
    SELECT 'other','別店','text','別店','segment',segment_conditions,'sending',0,0,'b'
      FROM broadcasts WHERE id='paced'`);
  expect(await dispatch(f.db, start)).toMatchObject({ acceptedRecipients: 100, nextDelaySeconds: 0 });
  const ordinary = await dispatch(f.db, start + 1_000);
  expect(ordinary).toMatchObject({ acceptedRecipients: 150, nextDelaySeconds: 0 });
  expect(f.raw.prepare("SELECT success_count FROM broadcasts WHERE id='paced'").get()).toEqual({ success_count: 100 });
  expect(f.raw.prepare("SELECT success_count FROM broadcasts WHERE id='z-normal'").get()).toEqual({ success_count: 150 });
  expect(f.raw.prepare("SELECT success_count FROM broadcasts WHERE id='other'").get()).toEqual({ success_count: 0 });
  f.raw.exec("UPDATE broadcasts SET stopped_at='2026-10-23' WHERE id='z-normal'");
  expect(await dispatch(f.db, start + 2_000)).toMatchObject({ acceptedRecipients: 0, nextDelaySeconds: 58 });
});

it('次の5分窓で起動し直しても直前の1分枠を引き継ぐ', async () => {
  const f = fixture();
  await dispatch(f.db, start + 290_000);
  expect(await dispatch(f.db, start + 300_000)).toMatchObject({ acceptedRecipients: 0, hasMore: true, nextDelaySeconds: 50 });
  expect(await dispatch(f.db, start + 350_000)).toMatchObject({ acceptedRecipients: 100, nextDelaySeconds: 60 });
  expect(new Set(wire.batches.flat()).size).toBe(200);
});

it('停止と再開でも1分枠と既送台帳を維持し、残りだけを送る', async () => {
  const f = fixture();
  await dispatch(f.db, start);
  await requestBroadcastStop(f.db, { id: 'paced', expectedVersion: 1 });
  expect(await dispatch(f.db, start + 1_000)).toMatchObject({ acceptedRecipients: 0, hasMore: false, nextDelaySeconds: null });
  await resumeBroadcastSending(f.db, { id: 'paced', expectedVersion: 2 });
  expect(await dispatch(f.db, start + 2_000)).toMatchObject({ acceptedRecipients: 0, nextDelaySeconds: 58 });
  expect(await dispatch(f.db, start + 60_000)).toMatchObject({ acceptedRecipients: 100, nextDelaySeconds: 60 });
  expect(wire.batches.flat()).toHaveLength(200);
  expect(new Set(wire.batches.flat()).size).toBe(200);
});

it('候補取得直後に別実行が枠を予約した場合も、ロック時に待機を再確認する', async () => {
  const f = fixture();
  const staleCandidateDb = new Proxy(f.db, { get(target, key) {
    if (key !== 'prepare') {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }
    return (sql: string) => {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(st, method) {
        if (method === 'bind') return (...args: unknown[]) => wrap(st.bind(...args));
        if (method === 'all' && sql.includes('dispatch_rank=1')) return async () => {
          const result = await st.all();
          await reserveBroadcastDispatchMinute(f.db, 'paced', start);
          return result;
        };
        const value = Reflect.get(st, method);
        return typeof value === 'function' ? value.bind(st) : value;
      } });
      return wrap(target.prepare(sql));
    };
  } });
  expect(await dispatch(staleCandidateDb, start)).toMatchObject({ acceptedRecipients: 0, hasMore: true, nextDelaySeconds: 60 });
  expect(wire.batches).toEqual([]);
  expect(f.raw.prepare("SELECT batch_offset FROM broadcasts WHERE id='paced'").get()).toEqual({ batch_offset: 0 });
});

it('待機時刻の永続化に失敗したら外部送信へ進まない', async () => {
  const f = fixture();
  f.raw.exec(`CREATE TRIGGER fail_pacing BEFORE INSERT ON platform_settings
    WHEN NEW.key='${BROADCAST_DISPATCH_NOT_BEFORE_PREFIX}paced'
    BEGIN SELECT RAISE(ABORT,'synthetic persistence failure'); END`);
  expect(await dispatch(f.db, start)).toMatchObject({ acceptedRecipients: 0, lineRequests: 0 });
  expect(wire.batches).toEqual([]);
});
