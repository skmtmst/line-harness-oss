import { describe, expect, test } from 'vitest';
import {
  formatStartsAtForStore,
  notificationTiming,
  renderNotificationText,
} from './booking-notifier.js';

const ctx = {
  menuName: 'カット',
  staffName: '山田',
  startsAt: '2026-05-10 14:00',
  daysUntil: 1,
  hoursUntil: 2,
};

describe('renderNotificationText', () => {
  test('受付', () => {
    const text = renderNotificationText('requested', ctx);
    expect(text).toContain('予約リクエストを受け付けました');
    expect(text).toContain('カット');
    expect(text).toContain('山田');
    expect(text).toContain('2026-05-10 14:00');
    expect(text).toContain('お店からの返信をお待ちください');
  });
  test('承認', () => {
    const text = renderNotificationText('approved', ctx);
    expect(text).toContain('予約が確定しました');
    expect(text).toContain('変更・キャンセルはお店に直接ご連絡ください');
  });
  test('拒否', () => {
    expect(renderNotificationText('rejected', ctx)).toContain('お取りできませんでした');
  });
  test('期限切れ', () => {
    expect(renderNotificationText('expired', ctx)).toContain('期限切れ');
  });
  test('前日リマインダ', () => {
    expect(renderNotificationText('day_before', ctx)).toContain('明日のご予約');
  });
  test('当日 N 時間前', () => {
    const t = renderNotificationText('hours_before', { ...ctx, daysUntil: 0 });
    expect(t).toContain('本日のご予約まであと 2 時間');
  });

  // R333: 送るのが遅れて当日になっても「明日」とは言わない。
  test('遅れて当日になった前日リマインダは本日と言う', () => {
    const t = renderNotificationText('day_before', { ...ctx, daysUntil: 0 });
    expect(t).toContain('本日のご予約');
    expect(t).not.toContain('明日のご予約');
  });
  test('ずれが2日以上なら「明日」を挟まず日時だけで伝える', () => {
    const t = renderNotificationText('day_before', { ...ctx, daysUntil: 2 });
    expect(t).toContain('ご予約のお知らせです');
    expect(t).not.toContain('明日');
    expect(t).not.toContain('本日');
  });
  test('当日お知らせも翌日なら「本日」とは言わない', () => {
    const t = renderNotificationText('hours_before', { ...ctx, daysUntil: 1, hoursUntil: 20 });
    expect(t).toContain('明日のご予約まであと 20 時間');
  });
});

// R332: 通知の日時は店舗の時間帯で書く。日本時間に固定しない。
describe('formatStartsAtForStore', () => {
  // 現地 2026-11-02 10:00 (America/New_York) = 15:00Z
  const startsAt = '2026-11-02T15:00:00.000Z';
  test('ニューヨークの店舗では現地日時を書く', () => {
    expect(formatStartsAtForStore(startsAt, 'America/New_York')).toBe('2026-11-02 10:00');
  });
  test('東京の店舗は従来どおり日本時間', () => {
    expect(formatStartsAtForStore(startsAt, 'Asia/Tokyo')).toBe('2026-11-03 00:00');
  });
  test('夏時間と標準時間でずれが違う (EST=-5)', () => {
    expect(formatStartsAtForStore('2026-01-15T15:00:00.000Z', 'America/New_York'))
      .toBe('2026-01-15 10:00');
  });
  test('未設定・壊れた値は日本時間に戻す', () => {
    expect(formatStartsAtForStore(startsAt, '')).toBe('2026-11-03 00:00');
    expect(formatStartsAtForStore(startsAt, 'not-a-zone')).toBe('2026-11-03 00:00');
  });
});

// R333: 「本日/明日」と残り時間は送信時点と店舗暦日から実測する。
describe('notificationTiming', () => {
  test('東京: 当日と翌日を店舗暦日で数える', () => {
    const now = new Date('2026-05-10T05:01:00Z'); // JST 14:01
    expect(notificationTiming('2026-05-11T05:00:00Z', 'Asia/Tokyo', now))
      .toEqual({ daysUntil: 1, hoursUntil: 24 });
    expect(notificationTiming('2026-05-10T10:00:00Z', 'Asia/Tokyo', now))
      .toEqual({ daysUntil: 0, hoursUntil: 5 });
  });
  test('遅れて当日になっても daysUntil=0', () => {
    // 前日分の通知が翌朝09:00(JST)に送られ、予約は同日11:00(JST)
    const now = new Date('2026-05-11T00:00:00Z');
    expect(notificationTiming('2026-05-11T02:00:00Z', 'Asia/Tokyo', now).daysUntil).toBe(0);
  });
  test('残り時間は実測。設定値は使わない (2時間なら2)', () => {
    const now = new Date('2026-05-10T03:00:00Z');
    expect(notificationTiming('2026-05-10T05:00:00Z', 'Asia/Tokyo', now).hoursUntil).toBe(2);
  });
  test('ニューヨーク店舗の暦日で本日かを判定する', () => {
    // NY 現地 09:30、予約は同日 10:00 (UTC では翌日に見えないよう選ぶ)
    const now = new Date('2026-11-02T14:30:00Z');
    expect(notificationTiming('2026-11-02T15:00:00Z', 'America/New_York', now))
      .toEqual({ daysUntil: 0, hoursUntil: 1 });
  });
  test('1時間未満は1として表示', () => {
    const now = new Date('2026-05-10T04:40:00Z');
    expect(notificationTiming('2026-05-10T05:00:00Z', 'Asia/Tokyo', now).hoursUntil).toBe(1);
  });
});
