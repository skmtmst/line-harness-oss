import { expect, it } from 'vitest';
import { zonedWallTime } from './zoned-time.js';
import { resolveReminderSendAt } from './reminder-timing.js';

it('日数を現地の暦でずらし、夏時間をまたいでも指定時刻を保つ',()=>{
 expect(zonedWallTime('2026-03-12','10:00','America/New_York',-7)).toBe('2026-03-05T15:00:00.000Z');
 expect(zonedWallTime('2026-11-02','18:00','Asia/Tokyo',-1)).toBe('2026-11-01T09:00:00.000Z');
 expect(zonedWallTime('2026-12-31','10:00','Asia/Tokyo',1)).toBe('2027-01-01T01:00:00.000Z');
});
it('時計が戻る日は先の一回、存在しない時刻は進めた側へ寄せる',()=>{
 expect(zonedWallTime('2026-11-01','01:30','America/New_York')).toBe('2026-11-01T05:30:00.000Z');
 expect(zonedWallTime('2026-03-08','02:30','America/New_York')).toBe('2026-03-08T07:30:00.000Z');
});
it('リマインダは指定した店の暦を使い、省略時の日本時間と分数指定は保つ',()=>{
 const target=new Date('2026-03-09T18:00:00Z'),step={offsetDays:-1,sendAtTime:'10:00',offsetMinutes:-120};
 expect(resolveReminderSendAt(target,step,'time','America/New_York').toISOString()).toBe('2026-03-08T14:00:00.000Z');
 expect(resolveReminderSendAt(target,step,'time').toISOString()).toBe('2026-03-09T01:00:00.000Z');
 expect(resolveReminderSendAt(target,step,'countdown','America/New_York').toISOString()).toBe('2026-03-09T16:00:00.000Z');
});
