import { describe, expect, it, vi } from 'vitest';
import {
  isWithinActiveWindow,
  isCoolingDown,
  isOperatorHandling,
  jstHhmm,
  shouldReply,
} from './auto-reply-conditions.js';

describe('時間帯の判定', () => {
  const w = (from: string | null, until: string | null) => ({
    active_from: from,
    active_until: until,
  });

  it('未設定なら常に返す', () => {
    expect(isWithinActiveWindow(w(null, null), '03:00')).toBe(true);
  });

  it('日中の時間帯', () => {
    expect(isWithinActiveWindow(w('09:00', '18:00'), '12:00')).toBe(true);
    expect(isWithinActiveWindow(w('09:00', '18:00'), '08:59')).toBe(false);
    expect(isWithinActiveWindow(w('09:00', '18:00'), '20:00')).toBe(false);
  });

  it('開始は含み、終了は含まない', () => {
    // 09:00-18:00 と 18:00-22:00 を並べたとき、18:00 が両方に入らないように。
    expect(isWithinActiveWindow(w('09:00', '18:00'), '09:00')).toBe(true);
    expect(isWithinActiveWindow(w('09:00', '18:00'), '18:00')).toBe(false);
  });

  it('日をまたぐ時間帯（営業時間外の自動応答）', () => {
    // ここを単純な範囲比較にすると常に偽になり、機能が丸ごと動かない。
    const night = w('22:00', '06:00');
    expect(isWithinActiveWindow(night, '23:30')).toBe(true);
    expect(isWithinActiveWindow(night, '02:00')).toBe(true);
    expect(isWithinActiveWindow(night, '05:59')).toBe(true);
    expect(isWithinActiveWindow(night, '06:00')).toBe(false);
    expect(isWithinActiveWindow(night, '12:00')).toBe(false);
    expect(isWithinActiveWindow(night, '21:59')).toBe(false);
  });

  it('開始だけの指定は「それ以降ずっと」', () => {
    expect(isWithinActiveWindow(w('18:00', null), '20:00')).toBe(true);
    expect(isWithinActiveWindow(w('18:00', null), '17:59')).toBe(false);
  });

  it('終了だけの指定は「それまでずっと」', () => {
    expect(isWithinActiveWindow(w(null, '06:00'), '05:00')).toBe(true);
    expect(isWithinActiveWindow(w(null, '06:00'), '06:00')).toBe(false);
  });

  it('開始と終了が同じときは時間帯なしとして扱う', () => {
    // 24時間か一瞬か読めない。返らない方が事故が大きいので返す側に倒す。
    expect(isWithinActiveWindow(w('09:00', '09:00'), '03:00')).toBe(true);
  });
});

describe('JSTの時刻', () => {
  it('UTCから9時間ずらす', () => {
    expect(jstHhmm(new Date('2026-08-15T00:30:00Z'))).toBe('09:30');
  });

  it('日付をまたいでも時刻だけ正しく出す', () => {
    expect(jstHhmm(new Date('2026-08-15T16:00:00Z'))).toBe('01:00');
  });
});

function dbReturning(value: unknown) {
  const first = vi.fn().mockResolvedValue(value);
  return {
    prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    _first: first,
  } as unknown as D1Database & { _first: ReturnType<typeof vi.fn> };
}

describe('連投の抑制', () => {
  const now = new Date('2026-08-15T03:00:00Z');

  it('未設定なら問い合わせもしない', async () => {
    const db = dbReturning(null);
    expect(await isCoolingDown(db, 'f-1', null, now)).toBe(false);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('0分も「抑制しない」', async () => {
    const db = dbReturning(null);
    expect(await isCoolingDown(db, 'f-1', 0, now)).toBe(false);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('直近の自動応答があれば抑制する', async () => {
    const db = dbReturning({ 1: 1 });
    expect(await isCoolingDown(db, 'f-1', 30, now)).toBe(true);
  });

  it('直近になければ抑制しない', async () => {
    const db = dbReturning(null);
    expect(await isCoolingDown(db, 'f-1', 30, now)).toBe(false);
  });
});

describe('有人対応の判定', () => {
  it('対応中なら true', async () => {
    expect(await isOperatorHandling(dbReturning({ status: 'in_progress' }), 'f-1')).toBe(true);
  });

  it('未読は対応中ではない', async () => {
    // 誰も見ていないのに自動応答まで止まると、問い合わせが放置される。
    expect(await isOperatorHandling(dbReturning({ status: 'unread' }), 'f-1')).toBe(false);
  });

  it('解決済みも対応中ではない', async () => {
    expect(await isOperatorHandling(dbReturning({ status: 'resolved' }), 'f-1')).toBe(false);
  });

  it('トーク行が無くても落ちない', async () => {
    expect(await isOperatorHandling(dbReturning(null), 'f-1')).toBe(false);
  });
});

describe('3条件をまとめた判定', () => {
  const now = new Date('2026-08-15T03:00:00Z'); // JST 12:00
  const base = {
    active_from: null,
    active_until: null,
    cooldown_minutes: null,
    skip_when_operator_active: 0,
  };

  it('条件が無ければ返す', async () => {
    expect(await shouldReply(dbReturning(null), base, 'f-1', now)).toBe(true);
  });

  it('時間帯の外なら、DBを引かずに返さない', async () => {
    const db = dbReturning(null);
    const ok = await shouldReply(
      db,
      { ...base, active_from: '18:00', active_until: '22:00' },
      'f-1',
      now,
    );
    expect(ok).toBe(false);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('有人対応中は返さない', async () => {
    const db = dbReturning({ status: 'in_progress' });
    expect(
      await shouldReply(db, { ...base, skip_when_operator_active: 1 }, 'f-1', now),
    ).toBe(false);
  });

  it('設定が切ってあれば有人対応でも返す', async () => {
    const db = dbReturning({ status: 'in_progress' });
    expect(await shouldReply(db, base, 'f-1', now)).toBe(true);
    // skip が 0 なら chats を引かない。
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('抑制中は返さない', async () => {
    const db = dbReturning({ 1: 1 });
    expect(await shouldReply(db, { ...base, cooldown_minutes: 30 }, 'f-1', now)).toBe(false);
  });
});
