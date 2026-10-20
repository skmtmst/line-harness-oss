import path from 'node:path'
// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventBookings from './event-bookings.js';

const calls = vi.hoisted(() => ({ read: vi.fn(), cancel: vi.fn(), leave: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { myEventBookings: calls.read, cancelMyEventBooking: calls.cancel, cancelMyEventWaitlist: calls.leave } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

/**
 * イベント予約の取り消し確認を、ブラウザの `confirm` から
 * LIFF 共通の確認窓 (`ui/ConfirmDialog`) へ移した契約。
 *
 * 動き・送る中身は変えない。閉じるを選ぶと何も起きず、
 * 取り消すを選ぶと今までどおり取り消しが動く。
 * 題と注意書きは V8 の板  の形（日時の題・待ちへの案内・前日の締め切り）。
 */

const root = join(import.meta.dirname, '..');
const page = readFileSync(path.resolve(__dirname, './event-bookings.tsx'), 'utf8');
const dialog = readFileSync(path.resolve(__dirname, '../components/ui/confirm-dialog.tsx'), 'utf8');

/** 注意書きの中の字に当てないため、コメントを外す。 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function fnBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `関数が見つかりません: ${signature}`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`関数の閉じ括弧が見つかりません: ${signature}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const BROWSER_DIALOG =
  /(?:^|[^.\w])(confirm|alert|prompt)\(|\b(?:window|globalThis|self)\.(confirm|alert|prompt)\(/;

describe('LIFF にブラウザの確認窓を残さない', () => {
  it('confirm・alert・prompt の呼び出しが無い', () => {
    const offenders = walk(join(root))
      .filter((f) => !f.includes('.test.'))
      .filter((f) => BROWSER_DIALOG.test(code(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(root.length + 1))
      .sort();
    expect(offenders, 'LIFF 共通の確認窓を使う').toEqual([]);
  });
});

describe('イベント予約の取り消し確認', () => {
  it('共通の確認窓を開くだけで、ブラウザの confirm を呼ばない', () => {
    expect(code(page), 'ブラウザのconfirmへ戻っている').not.toMatch(BROWSER_DIALOG);
    expect(page).toContain('setPendingCancel(b)');
  });

  it('題は日時＋行事の問いかけで、閉じると送らず、取り消しを確認して予約IDだけ送る', async () => {
    const booking = { id: 'booking-confirm', event_id: 'event-confirm', source: 'booking', status: 'confirmed', event_name: '撮影会', slot_starts_at: '2099-10-20T10:00:00Z', slot_ends_at: '2099-10-20T11:00:00Z', cancel_deadline_hours_before: 24 };
    calls.read.mockResolvedValue({ items: [booking] });
    calls.cancel.mockResolvedValue({ ok: true });
    render(createElement(MemoryRouter, null, createElement(EventBookings)));
    const detail=await screen.findByRole('button',{name:'撮影会のイベントを見る'});
    expect(detail.classList.contains('liff-hit')).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセルする' }));
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.getAttribute('aria-label')).toBe('10/20 19:00 の撮影会をキャンセルしますか');
    expect(within(confirmation).getByText('10/20 19:00 の撮影会をキャンセルしますか')).toBeTruthy();
    expect(within(confirmation).getByText(/キャンセル待ちの方へ順番に案内されます/)).toBeTruthy();
    expect(within(confirmation).getByText(/前日を過ぎるとここからは変えられません/)).toBeTruthy();
    expect(within(confirmation).getByRole('button', { name: 'キャンセルする' })).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: '閉じる' }));
    expect(calls.cancel).not.toHaveBeenCalled();
    expect(calls.leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセルする' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセルする' }));
    await waitFor(() => expect(calls.cancel).toHaveBeenCalledWith('booking-confirm'));
    expect(calls.cancel).toHaveBeenCalledTimes(1);
    expect(calls.leave).not.toHaveBeenCalled();
  });

  it('取り消しの確認窓に V8 の板の印 nUYyb を付けている', () => {
    expect(page).toContain('designNode="nUYyb"');
    expect(dialog).toContain('designNode');
    expect(dialog).toContain('data-design-node={designNode}');
  });

  it('閉じるを選ぶと取り消しを送らない', () => {
    // 取り消しの送信口は実行の経路に1つだけ。閉じる側にあればここで落ちる。
    expect(page.match(/cancelMyEventBooking/g)?.length ?? 0).toBe(1);
    const body = fnBody(code(page), 'async function runCancel');
    expect(body, '実行する側が取り消しを送っていない').toContain('api.cancelMyEventBooking(b.id)');
  });

  it('失敗の分け方を変えていない', () => {
    const body = fnBody(code(page), 'async function runCancel');
    for (const failure of ['cancel_deadline_passed', 'cancel_not_allowed', 'invalid_state']) {
      expect(body, `失敗の分けが消えている: ${failure}`).toContain(failure);
    }
    expect(body, '二度押しを止めていない').toContain('if (!b || busy) return');
  });
});

describe('LIFF 共通の確認窓の形', () => {
  it('取り消せない操作は赤い実行ボタン＋警告の印', () => {
    expect(dialog).toContain("role={destructive ? 'alertdialog' : 'dialog'}");
    expect(dialog).toContain("variant={destructive ? 'danger' : 'primary'}");
    expect(dialog).toContain('alert-triangle');
    expect(dialog).toContain("cancelLabel = '閉じる'");
  });

  it('開いていないときは出さず、処理中は閉じさせない', () => {
    expect(dialog).toContain('if (!open) return null');
    expect(dialog).toContain('disabled={busy}');
  });

  it('素の Tailwind 色・16進数を使わない', () => {
    expect(dialog).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    for (const banned of [
      'bg-green-',
      'text-green-',
      'bg-blue-',
      'text-blue-',
      'bg-gray-',
      'text-gray-',
      'bg-red-',
      'text-red-',
      'border-gray-',
      'bg-black/',
    ]) {
      expect(dialog).not.toContain(banned);
    }
  });
});
