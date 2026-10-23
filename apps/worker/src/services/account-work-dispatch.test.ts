import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { dispatchAccountWork } from './account-work-dispatch.js';
import { ACCOUNT_WORK_TASKS, type AccountWorkMessage } from './account-work-types.js';
import type { WorkerBindings } from '../worker-bindings.js';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => { fixture = createTestD1(); });
afterEach(() => { fixture.raw.close(); });
const started = Date.parse('2026-10-23T00:00:00Z');
function accounts(count: number, withWork = true) {
  const insert = fixture.raw.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,'fixture','fixture')`);
  const broadcast = fixture.raw.prepare(`INSERT INTO broadcasts
    (id,title,message_type,message_content,status,line_account_id) VALUES(?,'fixture','text','fixture','sending',?)`);
  const calendar = fixture.raw.prepare(`INSERT INTO google_calendar_connections
    (id,calendar_id,line_account_id,is_active) VALUES(?,?,?,1)`);
  fixture.raw.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = `store-${String(i).padStart(5, '0')}`; insert.run(id, id, id);
      if (withWork) { broadcast.run(`broadcast-${id}`, id); calendar.run(`calendar-${id}`, id, id); }
    }
  })();
}
function queueEnv(sendBatch = vi.fn(async (_messages: MessageSendRequest<AccountWorkMessage>[]) => {})) {
  return { env: { DB: fixture.db, ACCOUNT_WORK_QUEUE: { sendBatch } } as unknown as WorkerBindings, sendBatch };
}
test('5,000 accounts enqueue each task in bounded batches under the producer SQL budget', async () => {
  accounts(5_000);
  const { env, sendBatch } = queueEnv();
  let queries = 0;
  let selectionPlan: { id: number; parent: number; detail: string }[] = [];
  env.DB = new Proxy(fixture.db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => {
      queries++;
      if (sql.includes('AS has_broadcast') && selectionPlan.length === 0) {
        selectionPlan = fixture.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('', 100) as typeof selectionPlan;
      }
      return target.prepare(sql);
    };
    return Reflect.get(target, key);
  } });
  expect(await dispatchAccountWork(env, started)).toEqual({ enabled: true, accounts: 5_000, completed: true });
  expect(queries).toBeLessThan(250);
  const broadcastRead = selectionPlan.find(row => row.detail.startsWith('SEARCH b '));
  expect(broadcastRead).toBeDefined();
  // Build the account membership set once per page, not once per account.
  expect(selectionPlan.find(row => row.id === broadcastRead!.parent)?.detail).toMatch(/^LIST SUBQUERY/);
  expect(sendBatch.mock.calls).toHaveLength(50 * ACCOUNT_WORK_TASKS.length);
  const messages = sendBatch.mock.calls.flatMap(([rows]) => rows.map(row => row.body));
  expect(new Set(messages.map(message => `${message.task}:${message.accountId}`)).size).toBe(5_000 * ACCOUNT_WORK_TASKS.length);
  expect(messages.every(message => message.windowStartedAt === new Date(started).toISOString())).toBe(true);
  for (const [batch] of sendBatch.mock.calls) {
    expect(batch.length).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThan(256_000);
  }
  sendBatch.mockClear();
  expect((await dispatchAccountWork(env, started + 60_000)).accounts).toBe(0);
  expect(sendBatch).not.toHaveBeenCalled();
});
test('a partially accepted page is retried, and older work completes before a new window', async () => {
  accounts(201);
  const { env, sendBatch } = queueEnv();
  let calls = 0;
  sendBatch.mockImplementation(async () => { if (++calls === ACCOUNT_WORK_TASKS.length + 2) throw new Error('queue unavailable'); });
  await expect(dispatchAccountWork(env, started)).rejects.toThrow('queue unavailable');
  const checkpoint = fixture.raw.prepare("SELECT value FROM platform_settings WHERE key='account-work-dispatch'").get() as {value: string};
  expect(JSON.parse(checkpoint.value)).toMatchObject({ cursor: 'store-00099', completed: false });
  sendBatch.mockReset().mockResolvedValue(undefined);
  expect(await dispatchAccountWork(env, started + 5 * 60_000)).toEqual({ enabled: true, accounts: 101, completed: true });
  const messages = sendBatch.mock.calls.flatMap(([rows]) => rows.map(row => row.body));
  expect(messages.every(row => row.windowStartedAt === new Date(started).toISOString())).toBe(true);
  expect(messages.some(row => row.accountId === 'store-00200')).toBe(true);
  sendBatch.mockClear();
  expect((await dispatchAccountWork(env, started + 5 * 60_000)).accounts).toBe(201);
});
test('an overlapping producer cannot enqueue a second sweep', async () => {
  accounts(1);
  const { env, sendBatch } = queueEnv();
  let finish!: () => void, began!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const entered = new Promise<void>(resolve => { began = resolve; });
  sendBatch.mockImplementationOnce(async () => { began(); await wait; });
  const first = dispatchAccountWork(env, started);
  await entered;
  expect(await dispatchAccountWork(env, started)).toEqual({ enabled: true, accounts: 0, completed: false });
  finish(); await first;
  expect(sendBatch).toHaveBeenCalledTimes(ACCOUNT_WORK_TASKS.length);
});
test('a producer without its binding does not access the database', async () => {
  expect(await dispatchAccountWork({} as WorkerBindings, started)).toEqual({ enabled: false, accounts: 0, completed: false });
});

test('idle accounts omit delivery and calendar work but newly due work is picked up next window', async () => {
  accounts(5_000, false);
  const { env, sendBatch } = queueEnv();
  await dispatchAccountWork(env, started);
  const messages = sendBatch.mock.calls.flatMap(([rows]) => rows.map(row => row.body));
  expect(messages).toHaveLength(10_000);
  expect(new Set(messages.map(row => row.task))).toEqual(new Set(['health', 'analytics']));
  fixture.raw.exec(`INSERT INTO broadcasts(id,title,message_type,message_content,status,line_account_id)
    VALUES('later','fixture','text','fixture','sending','store-04999');
    INSERT INTO google_calendar_connections(id,calendar_id,line_account_id) VALUES('later','fixture','store-04999')`);
  sendBatch.mockClear();
  await dispatchAccountWork(env, started + 5 * 60_000);
  const extra = sendBatch.mock.calls.flatMap(([rows]) => rows.map(row => row.body))
    .filter(row => row.task === 'broadcast' || row.task === 'calendar');
  expect(extra.map(row => [row.task, row.accountId])).toEqual([
    ['broadcast', 'store-04999'], ['calendar', 'store-04999'],
  ]);
});

test('suspended, archived, and inactive accounts are excluded before enqueue', async () => {
  accounts(5);
  fixture.raw.exec(`INSERT INTO tenants(id,name,status) VALUES('stopped','fixture','suspended');
    UPDATE line_accounts SET tenant_id='stopped' WHERE id='store-00000';
    UPDATE line_accounts SET archived_at='2026-01-01' WHERE id='store-00001';
    UPDATE line_accounts SET is_active=0 WHERE id='store-00002';
    UPDATE line_accounts SET tenant_id='missing-tenant' WHERE id='store-00003'`);
  const { env, sendBatch } = queueEnv();
  expect((await dispatchAccountWork(env, started)).accounts).toBe(1);
  const messages = sendBatch.mock.calls.flatMap(([rows]) => rows.map(row => row.body));
  expect(messages).toHaveLength(4);
  expect(messages.every(row => row.accountId === 'store-00004')).toBe(true);
});

test('completed or stopped broadcasts and disabled connections do not create jobs', async () => {
  accounts(3);
  fixture.raw.exec(`UPDATE broadcasts SET sent_at='2026-01-01' WHERE line_account_id='store-00000';
    UPDATE broadcasts SET stopped_at='2026-01-01' WHERE line_account_id='store-00001';
    UPDATE broadcasts SET status='draft' WHERE line_account_id='store-00002';
    UPDATE google_calendar_connections SET is_active=0`);
  const { env, sendBatch } = queueEnv();
  await dispatchAccountWork(env, started);
  const messages = sendBatch.mock.calls.flatMap(([rows]) => rows.map(row => row.body));
  expect(messages).toHaveLength(6);
  expect(new Set(messages.map(row => row.task))).toEqual(new Set(['health', 'analytics']));
});
