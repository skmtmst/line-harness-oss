import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LIFF ★V7 その2 (イベント) の契約。
 *
 * 流儀は ui-contract.test.ts と同じ (描画試験はしない。文面を読む)。
 * 文言の固定ではなく、動き (選んでから進む・確認してから消す・
 * 失敗の分け方) と見た目の決まり (ボタン1つ・札に文字・素の色なし) を見る。
 */

const ROOT = join(import.meta.dirname, '..');

function src(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

const event = src('pages', 'Event.tsx');
const confirm = src('pages', 'EventConfirm.tsx');
const done = src('pages', 'EventDone.tsx');
const bookings = src('pages', 'EventBookings.tsx');
const offer = src('pages', 'EventWaitlistOffer.tsx');
const api = src('lib', 'api.ts');
const EVENT_FILES = [event, confirm, done, bookings, offer];

describe('素の Tailwind 色・16進数・絵文字が無い', () => {
  it('5画面のどこにも無い', () => {
    for (const text of EVENT_FILES) {
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      for (const banned of [
        'bg-green-',
        'text-green-',
        'bg-blue-',
        'text-blue-',
        'bg-gray-',
        'text-gray-',
        'border-gray-',
        'bg-red-',
        'text-red-',
        '#06c755',
        '#0b63ce',
        '📍',
        '📅',
        '⏳',
        '✅',
      ]) {
        expect(text).not.toContain(banned);
      }
    }
  });
});

describe('進む操作は下の操作の帯に1つだけ', () => {
  it('詳細は選んでから進む (枠タップで直接進まない)', () => {
    expect(event).toContain('<BottomBar>');
    expect(event.match(/<Button/g)?.length ?? 0).toBe(1);
    expect(event).toContain('variant="primary"');
    expect(event).toContain('selectedSlot');
    expect(event).toContain('時間を選んでください');
    expect(event).toContain('この時間で申し込む');
    // 枠のボタンは選択だけし、確認画面への遷移は帯のボタンが持つ。
    expect(event).toContain('setSelectedId(s.id)');
    expect(event).not.toContain('/confirm?slotId=${s.id}');
  });

  it('詳細の主ボタンは状態に合わせる (上限・満席・待ち)', () => {
    // 上限に達したら理由をボタンに出して押せなくする。
    expect(event).toContain('予約上限に達しています');
    // 全部満席なら「満席です」で押せない。枠自体が無い時も同じ。
    expect(event).toContain('満席です');
    expect(event).toContain('allFull');
    // 待ちを受けるイベントでは満席の枠を選べ、選んだら待ちに入る文言になる。
    expect(event).toContain('waitlistOpen');
    expect(event).toContain('キャンセル待ちに入る');
  });

  it('確認は申し込む1つ (戻るボタンは見出しの ← だけ)', () => {
    expect(confirm).toContain('<BottomBar>');
    expect(confirm).toMatch(/<Button[\s\S]*variant="primary"/);
    expect(confirm.match(/<Button/g)?.length ?? 0).toBe(2);
    expect(confirm).toContain('申し込む');
    expect(confirm).not.toContain('予約をリクエスト');
    expect(confirm).not.toContain('>戻る<');
  });

  it('確定・待ちは次の行き先が1つ', () => {
    expect(done).toContain('自分のイベントを見る');
    expect(done.match(/<Button/g)?.length ?? 0).toBe(1);
  });
});

describe('キャンセル待ちの分岐 (2-d)', () => {
  it('申込の返しに waitlisted がある', () => {
    expect(api).toContain('waitlisted: true');
    expect(api).toContain('CreateEventBookingResponse');
  });

  it('待ちに入ったときは確定と別の行き先へ進む', () => {
    expect(confirm).toContain("'waitlisted' in res");
    expect(confirm).toContain('status=waitlisted');
    expect(done).toContain("status === 'waitlisted'");
    expect(done).toContain('キャンセル待ちに入りました');
    expect(done).toContain('hourglass');
  });

  it('席が空いた案内の承諾は動きのまま (token・状態分け)', () => {
    expect(offer).toContain('api.acceptEventWaitlistOffer(token)');
    expect(offer).toContain('status === 410');
    expect(offer).toContain('status === 404 || status === 409');
  });

  it('案内の失敗は行き止まりにせず、もう一度試せる', () => {
    expect(offer).toContain('もう一度試す');
  });
});

describe('承認待ちと確定は別の印と文', () => {
  it('確定は暦・承認待ちと待ちは砂時計', () => {
    expect(done).toContain("status === 'requested'");
    expect(done).toContain('受付しました');
    expect(done).toContain('運営の承認をお待ちください');
  });
});

describe('自分のイベントは期限まで取り消せる', () => {
  it('取り消しの確認を出してから消す', () => {
    // ブラウザの confirm() は使わず、LIFF 共通の確認窓で聞く。
    expect(bookings).toContain('ConfirmDialog');
    expect(bookings).toContain('setPendingCancel(b)');
    expect(bookings).toContain('の予約をキャンセルしますか');
    expect(bookings).toContain('api.cancelMyEventBooking(b.id)');
  });

  it('期限の数え方と失敗の文言はそのまま', () => {
    expect(bookings).toContain('cancel_deadline_hours_before');
    expect(bookings).toContain('cancel_deadline_passed');
    expect(bookings).toContain('cancel_not_allowed');
    expect(bookings).toContain('invalid_state');
  });

  it('札は文字で出す (参加・承認待ち)', () => {
    expect(bookings).toContain("'参加'");
    expect(bookings).toContain("'承認待ち'");
    expect(bookings).toContain('<Badge');
  });

  it('切り替えは「これから／これまで」', () => {
    expect(bookings).toContain('これから');
    expect(bookings).toContain('これまで');
    expect(bookings).not.toContain('過去');
  });
});

describe('読み込み中・失敗の間は帯や操作を出さない', () => {
  it('取りに行く3画面が共通の読み込み・失敗を使う', () => {
    for (const text of [event, confirm, bookings]) {
      expect(text).toContain('LoadingView');
      expect(text).toContain('LoadErrorView');
    }
    // 確定画面はクエリだけ見て、案内画面は押してから送るので読み込みが無い。
    expect(done).not.toContain('LoadingView');
    expect(offer).not.toContain('LoadingView');
  });

  it('確認の送信失敗は入力を消さず、その場に理由を出す', () => {
    expect(confirm).toContain('role="alert"');
    expect(confirm).toContain('setSubmitError(msg)');
  });
});

describe('案内の帯は1画面に1本', () => {
  it('確認の帯は info 1つ (承認制の文は同じ帯に足す)', () => {
    expect(confirm.match(/bg-info-bg/g)?.length ?? 0).toBe(1);
    expect(confirm).toContain('キャンセルは期限まで');
    expect(confirm).not.toContain('bg-yellow');
  });
});

describe('詳細の満席と上限のお知らせ (m11b 仕上げ)', () => {
  it('満席の枠は押せない・灰色の地・薄い文字・hairline の枠・満席の読み上げ', () => {
    // 押せない枠は disabled。満席の読み上げ (aria-label に「満席」) がある。
    expect(event).toContain('disabled={disabled}');
    expect(event).toContain('aria-label={full ?');
    expect(event).toContain('満席');
    // 押せない時の地は1つだけ (bg-shell-gray)。白と重ねると白く見える。
    const disabledTone = event.match(/disabled\s*\?\s*'[^']*'/)?.[0] ?? '';
    expect(disabledTone).toContain('bg-shell-gray');
    expect(disabledTone).not.toContain('bg-canvas');
    expect(disabledTone).toContain('border-hairline');
    // 押せない時の文字は薄い色。
    expect(event).toContain('text-ink-faint');
  });

  it('選んだ時間は薄い緑の地＋濃い緑の枠', () => {
    expect(event).toContain('bg-ok-bg');
    expect(event).toContain('border-accent-deep');
    expect(event).toContain('setSelectedId(s.id)');
  });

  it('上限のお知らせは赤を使わず info の帯 (主ボタンと紐づく)', () => {
    expect(event).toContain('このイベントへの予約上限');
    expect(event).toContain('bg-info-bg');
    expect(event).toContain('text-ink-secondary');
    expect(event).toContain('name="info"');
    // 赤は失敗の時だけ。上限のお知らせには使わない。
    expect(event).not.toContain('text-danger');
    expect(event).not.toContain('text-red-');
    expect(event).not.toContain('bg-red-');
    // 下の主ボタンが押せない理由として読めるよう、帯とボタンを紐づける。
    expect(event).toContain('event-limit-note');
    expect(event).toContain('aria-describedby');
  });
});
