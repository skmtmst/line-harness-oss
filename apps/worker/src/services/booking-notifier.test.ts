import { describe, expect, test } from 'vitest';
import { renderBookingTemplate, renderNotificationText } from './booking-notifier.js';

const ctx = {
  menuName: 'カット',
  staffName: '山田',
  startsAtJst: '2026-05-10 14:00',
  hoursBefore: 2,
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
    const t = renderNotificationText('hours_before', ctx);
    expect(t).toContain('本日のご予約まであと 2 時間');
  });
});

describe('renderBookingTemplate', () => {
  test('replaces editable message variables and escaped line breaks', () => {
    expect(
      renderBookingTemplate(
        '予約確定\\n{{menu_name}} / {{ starts_at }} / {{unknown}}',
        { menu_name: '小顔矯正', starts_at: '2026-08-01 11:00' },
      ),
    ).toBe('予約確定\n小顔矯正 / 2026-08-01 11:00 /');
  });

  test('replaces LSTEP-compatible square bracket variables', () => {
    expect(
      renderBookingTemplate(
        '[name]様\\n[context.reserve.create_request.course.name]\\n[unknown.value]',
        {
          name: '坂本 真⼈',
          'context.reserve.create_request.course.name': 'オーダーメイド造顔ハイフ 65分',
        },
      ),
    ).toBe('坂本 真⼈様\nオーダーメイド造顔ハイフ 65分');
  });
});
