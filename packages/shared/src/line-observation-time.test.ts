import {expect,it} from 'vitest';
import {lineObservationTime,lineWebhookSilence,LINE_WEBHOOK_SILENCE_MS} from './line-observation-time.js';
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
