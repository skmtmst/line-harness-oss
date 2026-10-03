import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * お客さまの画面 (LIFF) の決まり (板 `sxNO5`) の契約。
 *
 * 流儀は ui-contract.test.ts と同じ (描画試験はしない。文面を読む)。
 * 決まりが崩れたらここが落ちる。直すときは板 `sxNO5` と見比べる。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function src(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

function app(...parts: string[]): string {
  return readFileSync(join(ROOT, '..', ...parts), 'utf8');
}

describe('LIFF の決まり (sxNO5)', () => {
  it('主の色は LIFF 専用の濃い緑で、管理画面の緑と変数を分ける', () => {
    const css = src('index.css');
    // 板: 主の色は #03873a。LINE の緑 #06c755 はログインボタンだけ。
    expect(css).toContain('--color-liff-primary: #03873a');
    // 管理画面 V8 の緑 (#087a3e) とは変数を分ける。
    expect(css).toContain('--color-liff-primary');
    expect(css).not.toMatch(/--color-liff-primary:\s*#087a3e/);
  });

  it('上の帯は ×・題・店名で、主ボタンは下の帯に固定する', () => {
    const header = src('components', 'ui', 'LiffHeader.tsx');
    expect(header).toContain('aria-label="閉じる"');
    expect(header).toContain('shopName');
    const bottom = src('components', 'ui', 'BottomBar.tsx');
    expect(bottom).toContain('fixed inset-x-0 bottom-0');
    // 主ボタンは高さ 48 (min-h-12)。
    const button = src('components', 'ui', 'Button.tsx');
    expect(button).toContain('min-h-12');
  });

  it('予約は 4 段の手順で、段が増えても同じ形になる', () => {
    const stepper = src('components', 'ui', 'Stepper.tsx');
    expect(stepper).toContain('aria-label="予約の手順"');
    // 段の数は呼び出し側が渡す (支払い段など増えても崩れない)。
    expect(stepper).toContain('steps: string[]');
  });

  it('読み込み中は骨格、失敗は「もう一度読み込む」、空きがないときは次の手', () => {
    const loading = src('components', 'LoadingView.tsx');
    expect(loading).toContain('animate-pulse');
    const error = src('components', 'LoadErrorView.tsx');
    expect(error).toContain('data-design-node="zz9R3"');
    expect(error).toContain('RETRY_LABEL');
    // 空きがないときは次の週・指名なしへの手を出す (ADutg)。
    const picker = src('components', 'DateTimePicker.tsx');
    expect(picker).toContain('次の週');
    expect(picker).toContain('指名なし');
  });

  it('幅 375 と 414 で確かめる', () => {
    const shots = app('scripts', 'qa-shots.mjs');
    expect(shots).toContain('width: 375');
    expect(shots).toContain('width: 414');
  });
});
