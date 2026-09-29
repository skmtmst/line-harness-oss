/*
 * イベント申込画面のキャンセル待ちまわり (#747 / N-416)。
 *
 * 直した2つ:
 *  (a) 満席の枠が押せず、キャンセル待ちの口へ辿り着けなかった
 *  (b) 待ちに入っただけなのに「予約が確定しました」と出ていた
 *
 * main.tsx はこの3関数を通す。ここを壊すと画面の挙動が変わる。
 */
import { describe, expect, it } from 'vitest';

import {
  bookingOutcome,
  doneScreenCopy,
  isSlotDisabled,
  slotSeatLabel,
} from './waitlist-view.js';

describe('(a) 満席の枠を押せるか', () => {
  it('満席でもキャンセル待ちを受ける回なら押せる', () => {
    expect(isSlotDisabled({ full: true, waitlistOpen: true, overLimit: false })).toBe(false);
  });

  it('満席でキャンセル待ちを受けない回は押せない', () => {
    expect(isSlotDisabled({ full: true, waitlistOpen: false, overLimit: false })).toBe(true);
  });

  it('空きがあれば当然押せる', () => {
    expect(isSlotDisabled({ full: false, waitlistOpen: false, overLimit: false })).toBe(false);
  });

  it('予約上限に達している人は、待ちを受ける回でも押せない', () => {
    // 待ちに入っても予約に変わらないので、押させない。
    expect(isSlotDisabled({ full: true, waitlistOpen: true, overLimit: true })).toBe(true);
    expect(isSlotDisabled({ full: false, waitlistOpen: true, overLimit: true })).toBe(true);
  });

  it('押せる満席の枠は、待ちだと分かる文言になる', () => {
    expect(slotSeatLabel({ capacity: 3, remaining: 0, waitlistOpen: true }))
      .toBe('満員（キャンセル待ち）');
    expect(slotSeatLabel({ capacity: 3, remaining: 0, waitlistOpen: false }))
      .toBe('満員');
    expect(slotSeatLabel({ capacity: 3, remaining: 2, waitlistOpen: true }))
      .toBe('残 2');
    expect(slotSeatLabel({ capacity: null, remaining: null, waitlistOpen: true }))
      .toBe('定員なし');
  });
});

describe('(b) 待ちに入っただけのときに確定と出さないか', () => {
  it('待ちの応答(200 + waitlisted)は確定にしない', () => {
    // サーバは 200 で返すので、送信側は例外を投げない。status は付いてこない。
    expect(bookingOutcome({ waitlisted: true })).toBe('waitlisted');
    expect(doneScreenCopy(bookingOutcome({ waitlisted: true })).title)
      .toBe('キャンセル待ちに入りました');
  });

  it('待ちの応答を確定の文言で出さない', () => {
    const copy = doneScreenCopy('waitlisted');
    expect(copy.title).not.toContain('確定');
    expect(copy.body).toContain('予約は取れていません');
  });

  it('承認待ちはこれまでどおり「受付しました」', () => {
    expect(bookingOutcome({ status: 'requested' })).toBe('requested');
    expect(doneScreenCopy('requested').title).toBe('受付しました');
  });

  it('確定はこれまでどおり「予約が確定しました」', () => {
    expect(bookingOutcome({ status: 'confirmed' })).toBe('confirmed');
    expect(doneScreenCopy('confirmed').title).toBe('予約が確定しました');
  });

  it('status が無い応答を確定として扱わない(待ちのときの実際の形)', () => {
    // 直す前は res.status が undefined のまま渡り、確定として出ていた。
    expect(bookingOutcome({ waitlisted: true, status: undefined })).toBe('waitlisted');
  });
});
