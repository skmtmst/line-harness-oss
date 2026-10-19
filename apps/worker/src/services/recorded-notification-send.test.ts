import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {sendRecordedNotification} from './recorded-notification-send.js';
let f:SqliteD1;
beforeEach(()=>{f=createTestD1()});afterEach(()=>f.raw.close());
it.each(['line','email'] as const)('%s の受理後に完了保存が落ちても自動再送しない',async channel=>{
 const send=vi.fn(async()=>undefined),input={sourceId:'fixture',channel,recipient:'fake',payload:'fixture',send};
 f.raw.exec("CREATE TRIGGER stop_completion BEFORE UPDATE ON outbound_send_requests WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'fixture completion'); END");
 await expect(sendRecordedNotification(f.db,input)).rejects.toMatchObject({deliveryStatus:'unknown'});
 f.raw.exec('DROP TRIGGER stop_completion');
 await expect(sendRecordedNotification(f.db,input)).rejects.toMatchObject({deliveryStatus:'unknown'});
 expect(send).toHaveBeenCalledTimes(1);
 expect(f.raw.prepare('SELECT status,retryable FROM outbound_send_requests').get()).toEqual({status:'unknown',retryable:0});
});
it('LINEの同じ鍵で安全に再開できる期限を過ぎたら保留する',async()=>{
 const send=vi.fn(async()=>{throw Object.assign(new Error('fixture rejected'),{status:429,retryAfter:'0'})});
 const input={sourceId:'fixture',channel:'line' as const,recipient:'fake',payload:'fixture',send};
 await expect(sendRecordedNotification(f.db,input)).rejects.toMatchObject({deliveryStatus:'failed'});
 f.raw.exec("UPDATE outbound_send_requests SET created_at='2020-01-01T00:00:00Z',next_retry_at='2020-01-01T00:00:00Z'");
 await expect(sendRecordedNotification(f.db,input)).rejects.toMatchObject({deliveryStatus:'unknown'});
 expect(send).toHaveBeenCalledTimes(1);
 expect(f.raw.prepare('SELECT status,failure_code FROM outbound_send_requests').get()).toEqual({status:'unknown',failure_code:'LINE_RETRY_KEY_EXPIRED'});
});
