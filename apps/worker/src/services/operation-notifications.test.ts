import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMessage = vi.hoisted(() => vi.fn(async (_to:string,_messages:unknown[],_key?:string) => ({})));
const sendViaXServerRelay = vi.hoisted(() => vi.fn(async (_url:string,_secret:string,_input:{to:string;subject:string;body:string}) => {
  throw new Error('email provider unavailable');
}));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessage = pushMessage; },
}));
vi.mock('./support-relay.js', () => ({ sendViaXServerRelay }));

import { enqueueOperationNotifications, stopOperationCapabilities } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { processOperationNotificationOutbox } from './operation-notifications.js';

describe('operation notification outbox', () => {
  beforeEach(() => {
    pushMessage.mockClear();
    sendViaXServerRelay.mockClear();
  });

  it('メール障害でもLINE通知を完了し、メールだけ再試行へ残す', async () => {
    const testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, line_user_id)
       VALUES ('owner-1', 'Owner', 'owner@example.test', 'owner', 'api-key', 'U-owner')`,
    ).run();
    const stopped = await stopOperationCapabilities(testDb.db, {
      lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], expectedVersion: 0,
      actorId: 'owner-1', reason: '障害対応',
    });
    if (stopped.status !== 'changed') throw new Error('stop failed');
    await enqueueOperationNotifications(testDb.db, {
      incidentId: stopped.incident.id, eventKind: 'stopped', payload: { reason: '障害対応' },
    });

    const env = {
      DB: testDb.db,
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      XSERVER_RELAY_URL: 'https://relay.example.test',
      XSERVER_RELAY_SECRET: 'secret',
    } as Env['Bindings'];
    await expect(processOperationNotificationOutbox(env)).resolves.toEqual({ sent: 1, failed: 1 });
    expect(pushMessage).toHaveBeenCalledOnce();
    expect(sendViaXServerRelay).toHaveBeenCalledOnce();
    expect(testDb.raw.prepare(
      'SELECT channel, status FROM operation_notification_outbox ORDER BY channel',
    ).all()).toEqual([
      { channel: 'email', status: 'failed' },
      { channel: 'line', status: 'sent' },
    ]);
  });
});

it.each(['line','email'] as const)('SEND-S05: %s の途中失敗後も成功済み宛先には二度送らない',async(channel)=>{
 const f=createTestD1();
 f.raw.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','試験','fixture','fixture')");
 for(const id of ['a','b'])f.raw.prepare("INSERT INTO staff_members(id,name,email,role,api_key,line_user_id) VALUES(?,?,?,'owner',?,?)").run(id,id,id+'@fixture.test',id,'U-'+id);
 const stopped=await stopOperationCapabilities(f.db,{lineAccountId:'a',capabilities:['broadcast_dispatch'],expectedVersion:0,actorId:'a',reason:'fixture'});
 if(stopped.status!=='changed')throw new Error('fixture');
 await enqueueOperationNotifications(f.db,{incidentId:stopped.incident.id,eventKind:'stopped',payload:{reason:'fixture'}});
 f.raw.prepare('DELETE FROM operation_notification_outbox WHERE channel<>?').run(channel);
 const delivered:string[]=[];let rejected=false;
 const fake=async(to:string)=>{delivered.push(to);if(to.endsWith('b')||to.startsWith('b@')){if(!rejected){rejected=true;throw Object.assign(new Error('fixture'),channel==='line'?{status:429,retryAfter:'0'}:{});}}};
 pushMessage.mockImplementation((to)=>fake(to) as never);sendViaXServerRelay.mockImplementation((_url,_secret,input)=>fake(input.to) as never);
 const env={DB:f.db,LINE_CHANNEL_ACCESS_TOKEN:'fixture',XSERVER_RELAY_URL:'https://fixture.invalid',XSERVER_RELAY_SECRET:'fixture'} as Env['Bindings'];
 await processOperationNotificationOutbox(env);
 f.raw.exec("INSERT INTO staff_members(id,name,email,role,api_key,line_user_id) VALUES('c','c','c@fixture.test','owner','c','U-c'); UPDATE staff_members SET email='changed@fixture.test',line_user_id='U-changed' WHERE id='b'");
 f.raw.exec("UPDATE operation_notification_outbox SET next_attempt_at='2000'; UPDATE outbound_send_requests SET next_retry_at='2000' WHERE status='failed'");
 await processOperationNotificationOutbox(env);
 expect(delivered.filter(to=>to==='U-a'||to==='a@fixture.test')).toHaveLength(1);
 expect(delivered).not.toContain('U-c');expect(delivered).not.toContain('c@fixture.test');expect(delivered).not.toContain('U-changed');
 expect(delivered.filter(to=>to==='U-b'||to==='b@fixture.test')).toHaveLength(channel==='line'?2:1);
 expect(f.raw.prepare('SELECT status,last_error FROM operation_notification_outbox').get()).toEqual({status:channel==='line'?'sent':'failed',last_error:channel==='line'?null:'notification_delivery_unknown'});
 f.raw.close();
});

it('/SEND-S05: 通知の完了保存が0件なら成功を返さず、補完でも二度送らない', async () => {
  const f = createTestD1();
  try {
    pushMessage.mockReset().mockResolvedValue({});
    f.raw.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','人工','fixture','fixture'); INSERT INTO staff_members(id,name,role,api_key,line_user_id) VALUES('a','人工','owner','fixture','U-a')");
    const stopped = await stopOperationCapabilities(f.db, { lineAccountId: 'a', capabilities: ['broadcast_dispatch'], expectedVersion: 0, actorId: 'a', reason: 'fixture' });
    if (stopped.status !== 'changed') throw new Error('fixture');
    await enqueueOperationNotifications(f.db, { incidentId: stopped.incident.id, eventKind: 'stopped', payload: { reason: 'fixture' } });
    f.raw.exec("DELETE FROM operation_notification_outbox WHERE channel='email'; CREATE TRIGGER ignore_completion BEFORE UPDATE ON operation_notification_outbox WHEN NEW.status='sent' BEGIN SELECT RAISE(IGNORE); END");
    const env = { DB: f.db, LINE_CHANNEL_ACCESS_TOKEN: 'fixture' } as Env['Bindings'];
    await expect(processOperationNotificationOutbox(env)).resolves.toEqual({ sent: 0, failed: 1 });
    expect(f.raw.prepare('SELECT status,last_error FROM operation_notification_outbox').get()).toEqual({ status: 'failed', last_error: 'notification_delivery_unknown' });
    f.raw.exec("DROP TRIGGER ignore_completion; UPDATE operation_notification_outbox SET next_attempt_at='2000'");
    await expect(processOperationNotificationOutbox(env)).resolves.toEqual({ sent: 1, failed: 0 });
    expect(pushMessage).toHaveBeenCalledTimes(1);
  } finally {
    f.raw.close();
  }
});

it('/SEND-S05: 宛先の固定を保存できなければ送信を始めない', async () => {
  const f = createTestD1();
  try {
    pushMessage.mockReset().mockResolvedValue({});
    f.raw.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','人工','fixture','fixture'); INSERT INTO staff_members(id,name,role,api_key,line_user_id) VALUES('a','人工','owner','fixture','U-a')");
    const stopped = await stopOperationCapabilities(f.db, { lineAccountId: 'a', capabilities: ['broadcast_dispatch'], expectedVersion: 0, actorId: 'a', reason: 'fixture' });
    if (stopped.status !== 'changed') throw new Error('fixture');
    await enqueueOperationNotifications(f.db, { incidentId: stopped.incident.id, eventKind: 'stopped', payload: { reason: 'fixture' } });
    f.raw.exec("DELETE FROM operation_notification_outbox WHERE channel='email'; CREATE TRIGGER ignore_recipients BEFORE UPDATE ON operation_notification_outbox WHEN NEW.payload_json<>OLD.payload_json BEGIN SELECT RAISE(IGNORE); END");
    const env = { DB: f.db, LINE_CHANNEL_ACCESS_TOKEN: 'fixture' } as Env['Bindings'];
    await expect(processOperationNotificationOutbox(env)).resolves.toEqual({ sent: 0, failed: 1 });
    expect(pushMessage).not.toHaveBeenCalled();
    expect(f.raw.prepare('SELECT status,last_error FROM operation_notification_outbox').get()).toEqual({ status: 'failed', last_error: 'notification_delivery_failed' });
    f.raw.exec("DROP TRIGGER ignore_recipients; UPDATE operation_notification_outbox SET next_attempt_at='2000'");
    await expect(processOperationNotificationOutbox(env)).resolves.toEqual({ sent: 1, failed: 0 });
    expect(pushMessage).toHaveBeenCalledTimes(1);
  } finally {
    f.raw.close();
  }
});
