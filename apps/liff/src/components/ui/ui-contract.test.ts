import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LIFF ★V7 の見た目の契約 (予約まわり)。
 *
 * 流儀は qa-guard.test.ts と同じ (描画試験はしない。文面を読む)。
 * 動き (保存・送信・読み直し) の試験は別にあり、ここでは見た目だけ見る。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UI = join(ROOT, 'components', 'ui');

function src(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

function ui(name: string): string {
  return readFileSync(join(UI, name), 'utf8');
}

/** 今回作り替えた予約まわりの文面。Event・Form・Webinar は次の PR なので外す。 */
const V7_FILES = [
  ui('Icon.tsx'),
  ui('Button.tsx'),
  ui('Card.tsx'),
  ui('Badge.tsx'),
  ui('PageHeader.tsx'),
  ui('BottomBar.tsx'),
  ui('Stepper.tsx'),
  ui('StatusView.tsx'),
  ui('ConfirmDialog.tsx'),
  src('components', 'LoadingView.tsx'),
  src('components', 'LoadErrorView.tsx'),
  src('components', 'MenuList.tsx'),
  src('components', 'StaffList.tsx'),
  src('components', 'DateTimePicker.tsx'),
  src('components', 'Confirm.tsx'),
  src('components', 'Done.tsx'),
  src('pages', 'Booking.tsx'),
  src('pages', 'BookingHistory.tsx'),
  src('components', 'HistoryCard.tsx'),
];

describe('★V7 の色はトークンだけ', () => {
  it('素の Tailwind 色・16進数・青ボタン・LINE の明るい緑のボタン地が無い', () => {
    for (const text of V7_FILES) {
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      for (const banned of [
        'bg-green-',
        'text-green-',
        'bg-blue-',
        'text-blue-',
        'bg-gray-',
        'text-gray-',
        'border-gray-',
        '#06c755',
        '#0b63ce',
      ]) {
        expect(text).not.toContain(banned);
      }
    }
  });

  it('Button の主は濃い緑・白文字、副は白の地に枠', () => {
    const button = ui('Button.tsx');
    expect(button).toContain('bg-accent-deep');
    expect(button).toContain('text-white');
    expect(button).toContain('bg-canvas');
    expect(button).toContain('border-hairline');
  });
});

describe('StatusView はボタンを1つだけ出す', () => {
  it('描くボタンは1か所で、action があるときだけ', () => {
    const view = ui('StatusView.tsx');
    expect(view.match(/<Button/g)?.length ?? 0).toBe(1);
    expect(view).toContain('{action &&');
  });
});

describe('LoadErrorView は日本語＋読み直しだけ', () => {
  it('英語・コード・赤を出さず、再読み込みを呼ぶ', () => {
    const view = src('components', 'LoadErrorView.tsx');
    expect(view).toContain('RETRY_LABEL');
    expect(view).toContain('onRetry');
    expect(view).toContain('cloud-off');
    expect(view).toContain('bg-state-mark');
    expect(view).toContain('LOAD_FAILED_MESSAGE');
    expect(view).toContain('note');
    // 画面に出るのは日本語の文とボタンの1文だけ。部品名・定数名は除く。
    const shown = view
      .split('\n')
      .filter((line) => line.includes('<p') || line.includes('{message}'))
      .join('\n');
    for (const banned of ['Error', 'API', 'status', '500', 'error code', 'エラーコード']) {
      expect(shown).not.toContain(banned);
    }
    for (const banned of ['text-red', 'bg-red', 'border-red']) {
      expect(view).not.toContain(banned);
    }
  });
});

describe('予約の履歴に操作は無い', () => {
  it('キャンセル・変更のボタンが無く、連絡先の案内がある', () => {
    const page = src('pages', 'BookingHistory.tsx');
    const card = src('components', 'HistoryCard.tsx');
    expect(page).not.toContain('キャンセルする');
    expect(page).not.toContain('変更する');
    expect(page).not.toContain('onCancel');
    expect(card).not.toContain('<button');
    expect(page).toContain('お店に LINE でご連絡ください');
  });

  it('札は確認待ち・確定の文字を出す', () => {
    const card = src('components', 'HistoryCard.tsx');
    expect(card).toContain('確認待ち');
    expect(card).toContain('確定');
  });

  it('切り替えは「これから／これまで」で、件数の重複表示が無い', () => {
    const page = src('pages', 'BookingHistory.tsx');
    expect(page).toContain('これから');
    expect(page).toContain('これまで');
    expect(page).not.toContain('過去');
    expect(page).not.toMatch(/これから \(\{/);
  });

  it('履歴の失敗には「予約はなくなっていません。」の一言を足す', () => {
    expect(src('pages', 'BookingHistory.tsx')).toContain('予約はなくなっていません。');
  });
});

describe('読み込み中・失敗の間は下の帯を出さない', () => {
  it('予約の3画面が合図を出し、Booking が帯を絞る', () => {
    for (const file of ['MenuList.tsx', 'StaffList.tsx', 'DateTimePicker.tsx']) {
      expect(src('components', file)).toContain('onLoadState');
    }
    const booking = src('pages', 'Booking.tsx');
    expect(booking).toContain('onLoadState');
    // 下の帯3つ (担当・日時・確認へ) すべてが合図待ち。素の帯は無い。
    expect(booking.match(/stepReady && \(/g)?.length ?? 0).toBe(3);
  });
});

describe('送信した画面は中央寄せ＋暦の印', () => {
  it('Done の履歴ボタンに calendar-days がある', () => {
    expect(src('components', 'Done.tsx')).toContain('calendar-days');
    expect(src('pages', 'Booking.tsx')).toContain('justify-center');
  });
});

describe('撮り直しの3点', () => {
  it('選んでいる日が見える位置まで横に流れる', () => {
    const picker = src('components', 'DateTimePicker.tsx');
    expect(picker).toContain('scrollIntoView');
    expect(picker).toContain("inline: 'center'");
    expect(picker).toContain("block: 'nearest'");
  });

  it('日時の帯は選ぶ前「日時を選んでください」・選んだら「M/D HH:MM で確認へ」', () => {
    const booking = src('pages', 'Booking.tsx');
    expect(booking).toContain('日時を選んでください');
    expect(booking).toContain('で確認へ');
  });

  it('中央寄せの本文は行末の1〜2文字落ちを防ぐ (説明文は pretty)', () => {
    expect(src('components', 'ui/StatusView.tsx')).toContain('text-pretty');
    expect(src('components', 'LoadErrorView.tsx')).toContain('text-pretty');
  });
});
