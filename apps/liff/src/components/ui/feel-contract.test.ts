import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(HERE, '..', '..');
const src = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');
const css = src('index.css');

/*
 * ★A LIFF の手応え (オーナー決定。V8.pen 修正案 L-1・L-4)。
 * 色・書体 (L-2・L-3) は変えない。
 */
describe('押す手応え (0.96・80ms・離すとばね160ms)', () => {
  it('ボタン・選ぶ行・日時の枠が共通の押しを通す', () => {
    expect(src('components', 'ui', 'Button.tsx')).toContain('liff-press');
    expect(src('components', 'MenuList.tsx')).toContain('liff-press');
    expect(src('components', 'StaffList.tsx')).toContain('liff-press');
    expect(src('components', 'DateTimePicker.tsx')).toContain('liff-press');
  });

  it('押しの値は指示どおり (80ms・0.96・ばね160ms)', () => {
    expect(css).toContain('transition-duration: 80ms');
    expect(css).toContain('scale(0.96)');
    expect(css).toContain('cubic-bezier(0.34, 1.36, 0.64, 1)');
    expect(css).toContain('160ms');
  });
});

describe('読み込みの光 (1.2s・0.3秒以内は出さない)', () => {
  it('光が左から右へ 1.2s で流れる', () => {
    expect(css).toContain('liff-feel-shimmer');
    expect(css).toContain('1.2s');
    expect(css).toContain('translateX(-100%)');
    expect(css).toContain('translateX(100%)');
  });
});

describe('手順の移り変わり (右から24px＋薄く・240ms)', () => {
  it('段が替わるたび中身だけ移り変わる', () => {
    const booking = src('pages', 'Booking.tsx');
    expect(booking).toContain('key={step}');
    expect(booking).toContain('liff-step');
    expect(css).toContain('translateX(24px)');
    expect(css).toContain('240ms');
    expect(css).toContain('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });
});

describe('下の帯は浮いたボタン (12px・ふんわり影)', () => {
  it('下から 12px 浮き、横いっぱいで影を持つ', () => {
    const bar = src('components', 'ui', 'BottomBar.tsx');
    expect(bar).toContain('fixed inset-x-0 bottom-0');
    expect(bar).toContain('max(0.75rem');
    expect(bar).toContain('shadow-lg');
  });
});

describe('動きを減らす設定では薄く入れ替えるだけ', () => {
  it('prefers-reduced-motion で押し・光・滑りを止める', () => {
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('liff-feel-fade');
  });
});
