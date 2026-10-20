import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { createScenario, createScenarioStep, enrollFriendInScenario, publishScenarioVersion } from '@line-crm/db';
import { processStepDeliveries } from '../../services/step-delivery.js';
vi.mock('../../services/auto-track.js', () => ({ decorateForFriendPush: async (_: unknown, messageType: string, content: string) => ({ messageType, content }) }));
let f: SqliteD1;
beforeEach(() => { f = createTestD1(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T00:00:00Z')); });
afterEach(() => { f.raw.close(); vi.useRealTimers(); });
async function setup() {
  const s = await createScenario(f.db,{name:'試験',triggerType:'manual'});
  await createScenarioStep(f.db,{scenarioId:s.id,stepOrder:0,messageType:'text',messageContent:'案内'});
  await publishScenarioVersion(f.db,s.id,{staffId:null,idempotencyKey:'publish'});
  insertFriend(f.raw,'f'); return (await enrollFriendInScenario(f.db,'f',s.id))!;
}
function provider() {
  const accepted = new Set<string>(); const keys: (string | undefined)[] = []; let deliveries = 0;
  const pushMessage = vi.fn(async (_target: string, _messages: unknown[], key?: string) => {
    keys.push(key); if (!key || !accepted.has(key)) deliveries++;
    if (key) accepted.add(key);
  });
  return { client: { pushMessage } as never, keys, delivered: () => deliveries };
}
function loseLogWrites(): D1Database {
  return new Proxy(f.db,{get(target,key,receiver){
    if(key==='batch') return async()=>{throw new Error('process lost after provider acceptance');};
    return Reflect.get(target,key,receiver);
  }});
}
describe('SEND-S02: LINE受理と進捗保存の間で中断', () => {
  it('回復で同じUUIDキーを渡し、同じ通を二重受理させない', async () => {
    const e = await setup(), p = provider();
    await processStepDeliveries(loseLogWrites(),p.client);
    f.raw.prepare("UPDATE friend_scenarios SET updated_at='2026-10-10T00:00:00.000' WHERE id=?").run(e.id);
    vi.setSystemTime(new Date('2026-10-11T00:06:00Z'));
    await processStepDeliveries(f.db,p.client);
    expect(p.delivered()).toBe(1);
    expect(p.keys).toHaveLength(2); expect(p.keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(p.keys[1]).toBe(p.keys[0]);
    expect(f.raw.prepare('SELECT status FROM friend_scenarios').get()).toEqual({status:'completed'});
  });
  it('再開時に予定時刻が変わっても、同じ実行・友だち・通の鍵を保つ', async () => {
    const e = await setup(), p = provider();
    await processStepDeliveries(loseLogWrites(),p.client);
    f.raw.prepare("UPDATE friend_scenarios SET status='active',next_delivery_at='2026-10-11T00:05:00Z',updated_at='2026-10-10T00:00:00.000' WHERE id=?").run(e.id);
    vi.setSystemTime(new Date('2026-10-11T00:06:00Z'));
    await processStepDeliveries(f.db,p.client);
    expect(p.delivered()).toBe(1); expect(p.keys[1]).toBe(p.keys[0]);
  });
  it('24時間を越えた中断は要確認として止め、自動再送しない', async () => {
    const e = await setup(), p = provider();
    await processStepDeliveries(loseLogWrites(),p.client);
    f.raw.prepare("UPDATE friend_scenarios SET updated_at='2026-10-10T00:00:00.000' WHERE id=?").run(e.id);
    vi.setSystemTime(new Date('2026-10-12T01:00:00Z'));
    await processStepDeliveries(f.db,p.client);
    expect(p.delivered()).toBe(1); expect(p.keys).toHaveLength(1);
    expect(f.raw.prepare('SELECT status,pause_reason FROM friend_scenarios').get()).toEqual({status:'paused',pause_reason:'delivery_unconfirmed'});
    expect(f.raw.prepare('SELECT status,retryable FROM outbound_send_requests').get()).toEqual({status:'unknown',retryable:0});
  });
});
