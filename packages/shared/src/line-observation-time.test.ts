import {expect,it} from 'vitest';
import {lineObservationTime,lineWebhookSilence,storedTimestamp,LINE_WEBHOOK_SILENCE_MS} from './line-observation-time.js';
it('無受信の境界とJST保存・除外・不明な時刻を区別する',()=>{
 const now=Date.parse('2026-10-30T00:00:00Z');
 expect(lineObservationTime('2026-10-30T09:00:00')).toBe(now);
 expect(lineObservationTime('2026-10-30T09:00:00+09:00')).toBe(now);
 expect(lineWebhookSilence({lastReceivedAt:new Date(now-LINE_WEBHOOK_SILENCE_MS).toISOString()},now)).toBe(false);
 expect(lineWebhookSilence({lastReceivedAt:'2026-10-29T08:59:59'},now)).toBe(true);
 expect(lineWebhookSilence({createdAt:'2026-10-28T09:00:00'},now)).toBe(true);
 expect(lineWebhookSilence({createdAt:'2026-10-28T09:00:00',exempt:true},now)).toBe(false);
 expect(lineWebhookSilence({lastReceivedAt:'invalid'},now)).toBe(false);
 expect(lineWebhookSilence({},now)).toBe(false);
});

it('SQLite の UTC 既定値を受信なしの経過時間に使う', () => {
 const created = '2026-10-30 09:00:00';
 expect(lineWebhookSilence({createdAt: created}, Date.parse('2026-10-31T08:59:59Z'))).toBe(false);
 expect(lineWebhookSilence({createdAt: created}, Date.parse('2026-10-31T09:00:01Z'))).toBe(true);
});

it('保存形式の違いをUTC・JST・明示時差として区別する', () => {
 const now = Date.parse('2026-11-04T10:00:00Z');
 expect(Date.parse(storedTimestamp('2026-11-04 10:00:00'))).toBe(now);
 expect(Date.parse(storedTimestamp('2026-11-04T19:00:00.000'))).toBe(now);
 expect(Date.parse(storedTimestamp('2026-11-04T12:00:00+02:00'))).toBe(now);
});
