import {afterEach,beforeEach,expect,it} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {storeSupportEmail} from './support-email.js';
let f:SqliteD1;
beforeEach(()=>{f=createTestD1()});afterEach(()=>f.raw.close());
const input={customerEmail:'student@fixture.test',subject:'質問',bodyText:'人工の質問',sentAt:'2026-10-11T01:00:00Z'};
it('Message-IDなしの同じメールを指紋で1通にする',async()=>{
 const results=await Promise.all([storeSupportEmail({DB:f.db},input),storeSupportEmail({DB:f.db},input)]);
 expect(f.raw.prepare('SELECT COUNT(*) n FROM support_email_messages').get()).toEqual({n:1});
 expect(results.filter(r=>r.duplicate)).toHaveLength(1);
 expect(f.raw.prepare('SELECT COUNT(*) n FROM inbox_conversation_events').get()).toEqual({n:1});
 await storeSupportEmail({DB:f.db},{...input,sentAt:'2026-10-11T02:00:00Z'});
 expect(f.raw.prepare('SELECT COUNT(*) n FROM support_email_messages').get()).toEqual({n:2});
});
it('同じ人の最初の2通が同時でも1つのやり取りにまとめる',async()=>{
 const results=await Promise.all(['one','two'].map(messageId=>storeSupportEmail({DB:f.db},{...input,messageId,bodyText:messageId})));
 expect(new Set(results.map(r=>r.threadId)).size).toBe(1);
 expect(f.raw.prepare('SELECT COUNT(*) n FROM support_email_threads').get()).toEqual({n:1});
 expect(f.raw.prepare('SELECT COUNT(*) n FROM support_email_messages').get()).toEqual({n:2});
 expect(f.raw.prepare('SELECT revision FROM support_email_threads').get()).toEqual({revision:2});
});
