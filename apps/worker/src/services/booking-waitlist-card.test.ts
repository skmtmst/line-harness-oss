/**
 * 空き知らせカードの形（B-1 fLNQx）。
 *
 * - 見出しは店の時間帯の「10月2日（金）13:00」。曜日は暦どおり。
 * - 押し先2つはお客さまの予約画面（LIFF）。形だけ決め、画面は M6 が作る。
 */
import { describe, expect, it } from 'vitest';
import {
  buildWaitlistInviteBubble,
  formatSlotHeadline,
  waitlistBookUrl,
  waitlistDeclineUrl,
} from './booking-waitlist-card.js';

const LIFF_BASE = 'https://liff.line.me/test123';

describe('空き知らせカード', () => {
  it('見出しは店の時間帯の日付と曜日', () => {
    // 2026-10-02 13:00 JST は金曜日。
    expect(formatSlotHeadline('2026-10-02T04:00:00.000Z', 'Asia/Tokyo'))
      .toBe('10月2日（金）13:00');
  });

  it('押し先2つの URL の形', () => {
    expect(waitlistBookUrl(LIFF_BASE, 'wait-1'))
      .toBe('https://liff.line.me/test123/booking?waitlist=wait-1');
    expect(waitlistDeclineUrl(LIFF_BASE, 'wait-1'))
      .toBe('https://liff.line.me/test123/booking/waitlist/wait-1/decline');
  });

  it('吹き出しに見出し・中身・押し先2つが入る', () => {
    const bubble = buildWaitlistInviteBubble({
      headline: '10月2日（金）13:00',
      detail: 'トリミング（小型犬）・担当 山田',
      holdLine: '15:12 まではこちらだけが予約できます。',
      bookUrl: waitlistBookUrl(LIFF_BASE, 'wait-1'),
      declineUrl: waitlistDeclineUrl(LIFF_BASE, 'wait-1'),
    });
    const json = JSON.stringify(bubble);
    expect(json).toContain('キャンセル待ちのお知らせ');
    expect(json).toContain('10月2日（金）13:00 に空きが出ました');
    expect(json).toContain('トリミング（小型犬）・担当 山田');
    expect(json).toContain('15:12 まではこちらだけが予約できます。');
    expect(json).toContain('この時間で予約する');
    expect(json).toContain('今回は見送る');
    expect(json).toContain('waitlist=wait-1');
    expect(json).toContain('/booking/waitlist/wait-1/decline');
  });
});
