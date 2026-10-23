import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { WorkerBindings } from '../worker-bindings.js';
import { ACCOUNT_WORK_MAX_CONTINUATIONS, isAccountWorkMessage, type AccountWorkMessage } from './account-work-types.js';
const calls = vi.hoisted(() => ({ account: vi.fn(), tenant: vi.fn(), analytics: vi.fn(), health: vi.fn(), broadcast: vi.fn(), calendar: vi.fn() }));
vi.mock('@line-crm/db', async original => ({
  ...await original<typeof import('@line-crm/db')>(), getLineAccountById: calls.account, isLineAccountTenantActive: calls.tenant,
}));
vi.mock('./analytics-projection.js', () => ({ refreshAccountAnalyticsProjection: calls.analytics }));
vi.mock('./operations-health.js', () => ({ runOperationHealthChecks: calls.health }));
vi.mock('../features/booking/booking-calendar-settings/index.js', () => ({ refreshCalendarBusyCaches: calls.calendar }));
vi.mock('../features/broadcasts/broadcast/index.js', () => ({ processQueuedBroadcasts: calls.broadcast }));
import { AccountWorkBusyError, consumeAccountWork } from './account-work-consumer.js';
let fixture: ReturnType<typeof createTestD1>, env: WorkerBindings;
const send = vi.fn();
const message: AccountWorkMessage = {kind:'account_work',task:'analytics',accountId:'store-a',windowStartedAt:'2026-10-23T00:00:00.000Z',sequence:0};
beforeEach(() => {
  fixture = createTestD1(); vi.resetAllMocks();
  fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
    VALUES('store-a','store-a','A','fixture','fixture'),('store-b','store-b','B','fixture','fixture')`);
  env = {DB:fixture.db,ACCOUNT_WORK_QUEUE:{send},WORKER_URL:'https://fixture.invalid',LINE_CREDENTIAL_ENCRYPTION_KEY:'fixture-key'} as unknown as WorkerBindings;
  calls.account.mockImplementation(async (_db, id) => ({id,is_active:1,channel_access_token:'fixture-token'}));
  calls.tenant.mockResolvedValue(true);
  calls.analytics.mockResolvedValue({failed:0,inProgress:0});
  calls.calendar.mockResolvedValue({processed:1,hasMore:false});
  calls.health.mockResolvedValue({run:{status:'completed'}});
  calls.broadcast.mockResolvedValue({hasMore:false,recipients:0,acceptedRecipients:0,retryDeferred:false});
  send.mockResolvedValue(undefined);
});
afterEach(() => { fixture.raw.close(); vi.useRealTimers(); });
test('redelivery executes a successful account chunk once; older windows are skipped', async () => {
  await consumeAccountWork(env,message); await consumeAccountWork(env,message);
  await consumeAccountWork(env,{...message,windowStartedAt:'2026-10-22T23:55:00.000Z'});
  expect(calls.analytics).toHaveBeenCalledOnce();
  expect(calls.account).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
test('failed work is retriable and never marks the window complete', async () => {
  calls.analytics.mockResolvedValueOnce({failed:1,inProgress:0});
  await expect(consumeAccountWork(env,message)).rejects.toThrow('account_projection_failed');
  await consumeAccountWork(env,message);
  expect(calls.analytics).toHaveBeenCalledTimes(2);
});
test('failed continuation enqueue retries; duplicate continuation is harmless and chains are bounded', async () => {
  calls.analytics.mockResolvedValue({failed:0,inProgress:1});
  send.mockRejectedValueOnce(new Error('queue offline'));
  await expect(consumeAccountWork(env,message)).rejects.toThrow('queue offline');
  await consumeAccountWork(env,message);
  expect(send).toHaveBeenLastCalledWith({...message,sequence:1},{delaySeconds:1});
  const next = {...message,sequence:1};
  await consumeAccountWork(env,next); await consumeAccountWork(env,next);
  expect(calls.analytics).toHaveBeenCalledTimes(3);
  send.mockClear();
  await consumeAccountWork(env,{...message,sequence:ACCOUNT_WORK_MAX_CONTINUATIONS});
  expect(send).not.toHaveBeenCalled();
});
test('disabled account or tenant never dispatches work', async () => {
  fixture.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='store-a'");
  await consumeAccountWork(env,message);
  calls.tenant.mockResolvedValue(false);
  await consumeAccountWork(env,{...message,accountId:'store-b'});
  expect(calls.analytics).not.toHaveBeenCalled();
});
test('broadcast work scopes its own account and does not loop on paused work', async () => {
  calls.broadcast.mockResolvedValue({hasMore:true,recipients:0,acceptedRecipients:0,retryDeferred:false});
  await consumeAccountWork(env,{...message,task:'broadcast'});
  expect(calls.broadcast).toHaveBeenCalledWith(fixture.db,expect.anything(),'https://fixture.invalid',{
    accountId:'store-a',credentialEncryptionKey:'fixture-key',
  });
  expect(send).not.toHaveBeenCalled();
});
test('broadcast waits for refreshed credentials before attempting delivery and can retry the same message', async () => {
  calls.account.mockResolvedValueOnce({id:'store-a',is_active:1,channel_access_token:'expired-fixture',token_expires_at:new Date(Date.now()-1).toISOString()});
  const work = {...message,task:'broadcast' as const};
  await expect(consumeAccountWork(env,work)).rejects.toThrow('account_work_credentials_not_ready');
  expect(calls.broadcast).not.toHaveBeenCalled();
  calls.account.mockResolvedValueOnce({id:'store-a',is_active:1,channel_access_token:'refreshed-fixture',token_expires_at:new Date(Date.now()+3_600_000).toISOString()});
  await consumeAccountWork(env,work);
  expect(calls.broadcast).toHaveBeenCalledOnce();
});
test('concurrent duplicate retries instead of acknowledging an unfinished owner', async () => {
  let finish!: () => void, began!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const entered = new Promise<void>(resolve => { began = resolve; });
  calls.analytics.mockImplementationOnce(async () => { began(); await wait; return {failed:0,inProgress:0}; });
  const first = consumeAccountWork(env,message); await entered;
  await expect(consumeAccountWork(env,message)).rejects.toBeInstanceOf(AccountWorkBusyError);
  finish(); await first;
  await consumeAccountWork(env,message);
  expect(calls.analytics).toHaveBeenCalledOnce();
});
test('a lease left by a terminated invocation expires before the 21-minute retry and work resumes', async () => {
  vi.useFakeTimers();
  const now = Date.parse(message.windowStartedAt);
  vi.setSystemTime(now);
  const leaseKey = 'scheduled-work:account-work:analytics:store-a';
  fixture.raw.prepare('INSERT INTO platform_settings(key,value) VALUES(?,?)')
    .run(leaseKey,JSON.stringify({owner:'terminated-invocation',expiresAt:now+20*60_000}));
  await expect(consumeAccountWork(env,message)).rejects.toMatchObject({
    name:'AccountWorkBusyError',retryDelaySeconds:21*60,
  });
  expect(calls.analytics).not.toHaveBeenCalled();
  expect(fixture.raw.prepare("SELECT value FROM platform_settings WHERE key='account-work-completed:analytics:store-a'").get()).toBeUndefined();
  vi.advanceTimersByTime(21*60_000);
  await consumeAccountWork(env,message);
  expect(calls.analytics).toHaveBeenCalledOnce();
  expect(fixture.raw.prepare('SELECT value FROM platform_settings WHERE key=?').get(leaseKey)).toBeUndefined();
  await consumeAccountWork(env,message);
  expect(calls.analytics).toHaveBeenCalledOnce();
});
test('health failures retry and malformed messages are rejected before DB work', async () => {
  calls.health.mockResolvedValueOnce({run:{status:'running'}});
  await expect(consumeAccountWork(env,{...message,task:'health'})).rejects.toThrow('account_health_incomplete');
  await consumeAccountWork(env,{...message,task:'health'});
  for (const value of [null,{}, {...message,sequence:-1},{...message,task:'unknown'},{...message,accountId:''},{...message,windowStartedAt:'invalid'}]) {
    expect(isAccountWorkMessage(value)).toBe(false);
  }
  await expect(consumeAccountWork(env,{})).rejects.toThrow('invalid_account_work_message');
  expect(calls.health).toHaveBeenCalledTimes(2);
});

test('partial acceptance followed by rate limiting waits for the next window', async () => {
  calls.broadcast.mockResolvedValue({hasMore:true,recipients:2,acceptedRecipients:1,retryDeferred:true});
  await consumeAccountWork(env,{...message,task:'broadcast'});
  expect(send).not.toHaveBeenCalled();
});

test('spread delivery continuation waits for its persisted next send time even when this attempt is early', async () => {
  const work = {...message,task:'broadcast' as const};
  calls.broadcast.mockResolvedValueOnce({hasMore:true,acceptedRecipients:100,retryDeferred:false,nextDelaySeconds:60});
  await consumeAccountWork(env,work);
  expect(send).toHaveBeenLastCalledWith({...work,sequence:1},{delaySeconds:60});
  calls.broadcast.mockResolvedValueOnce({hasMore:true,acceptedRecipients:0,retryDeferred:false,nextDelaySeconds:23});
  await consumeAccountWork(env,{...work,sequence:1});
  expect(send).toHaveBeenLastCalledWith({...work,sequence:2},{delaySeconds:23});
});

test('an unusable LINE credential does not prevent an independent analytics chunk', async () => {
  fixture.raw.exec("UPDATE line_accounts SET channel_access_token='',channel_access_token_encrypted='invalid-fixture'");
  await consumeAccountWork(env,message);
  expect(calls.analytics).toHaveBeenCalledOnce(); expect(calls.account).not.toHaveBeenCalled();
});

test('calendar continues one connection at a time inside the same window', async () => {
  calls.calendar.mockResolvedValueOnce({processed:1,hasMore:true});
  const work = {...message,task:'calendar' as const};
  await consumeAccountWork(env,work);
  expect(calls.calendar).toHaveBeenCalledWith(fixture.db,expect.anything(),expect.any(Date),{
    accountId:'store-a',attemptedBefore:message.windowStartedAt,
  });
  expect(send).toHaveBeenCalledExactlyOnceWith({...work,sequence:1},{delaySeconds:1});
  send.mockClear();
  await consumeAccountWork(env,{...work,sequence:1});
  expect(send).not.toHaveBeenCalled();
});
