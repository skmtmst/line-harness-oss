import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * イベント予約の取り消し確認を、ブラウザの `confirm()` から
 * LIFF 共通の確認窓 (`ui/ConfirmDialog`) へ移した契約。
 *
 * 動き・文言の意味・送る中身は変えない。やめるを選ぶと何も起きず、
 * 取り消すを選ぶと今までどおり取り消しが動く。
 */

const root = join(import.meta.dirname, '..');
const page = readFileSync(join(import.meta.dirname, 'EventBookings.tsx'), 'utf8');
const dialog = readFileSync(join(root, 'components', 'ui', 'ConfirmDialog.tsx'), 'utf8');

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
    expect(page).toContain("import ConfirmDialog from '../components/ui/ConfirmDialog.js'");
    expect(code(page), 'ブラウザのconfirmへ戻っている').not.toMatch(BROWSER_DIALOG);
    expect(page).toContain('setPendingCancel(b)');
  });

  it('題は今までどおりの問いかけで、ボタンは「やめる」と取り消し', () => {
    expect(page).toContain('の予約をキャンセルしますか？');
    expect(page).toContain('cancelLabel="やめる"');
    expect(page).toContain('confirmLabel="キャンセルする"');
    expect(page).toContain('destructive');
  });

  it('やめるを選ぶと取り消しを送らない', () => {
    // 取り消しの送信口は実行の経路に1つだけ。やめる側にあればここで落ちる。
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
    expect(dialog).toContain("cancelLabel = 'やめる'");
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
