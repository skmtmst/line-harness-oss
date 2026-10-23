import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { dispatchAccountWork } from './account-work-dispatch.js';
import { ACCOUNT_WORK_TASKS, type AccountWorkMessage } from './account-work-types.js';
import type { WorkerBindings } from '../worker-bindings.js';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => { fixture = createTestD1(); });
afterEach(() => { fixture.raw.close(); });
const started = Date.parse('2026-10-23T00:00:00Z');
function accounts(count: number) {
  const insert = fixture.raw.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,'fixture','fixture')`);
  fixture.raw.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = `store-${String(i).padStart(5, '0')}`; insert.run(id, id, id);
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
  env.DB = new Proxy(fixture.db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => { queries++; return target.prepare(sql); };
    return Reflect.get(target, key);
  } });
  expect(await dispatchAccountWork(env, started)).toEqual({ enabled: true, accounts: 5_000, completed: true });
  expect(queries).toBeLessThan(250);
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
