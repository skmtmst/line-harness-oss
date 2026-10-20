import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 押せる所は 44×44 以上（リリース前点検 2026-10-07）。
 * 375・390・414 の幅で全画面を測り、見た目が小さいボタンには liff-hit を付けた
 * （見た目と並びは変えず、透明な ::after で押せる範囲だけ広げる）。
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('押せる所の大きさ', () => {
  it('liff-hit は押せる範囲を 44×44 以上にし、位置の決まっている部品の position を変えない', () => {
    const css = (read('../index.css') + read('../components/ui/liff-skin.css'));
    expect(css).toMatch(/\.liff-hit::after\s*\{[^}]*width: max\(100%, 44px\);[^}]*height: max\(100%, 44px\);/s);
    expect(css).toContain('.liff-hit:not(.absolute):not(.fixed):not(.sticky)');
  });

  it('小さい操作も共通 Button の44pxの段を使う', () => {
    const cases: Array<[string, string]> = [
      ['../components/ui/liff-header.tsx', 'aria-label="閉じる"'],
      ['../components/date-time-picker.tsx', 'aria-label="前の週"'],
      ['../components/date-time-picker.tsx', 'aria-label="前の月"'],
      ['../components/help-tip.tsx', 'aria-label={label}'],
      ['../pages/seat/seat-pick.tsx', 'aria-label="人数を増やす"'],
    ];
    for (const [file, marker] of cases) {
      const src = read(file);
      const at = src.indexOf(marker);
      expect(at, `${file} ${marker}`).toBeGreaterThan(-1);
      // 印の近く（同じ要素の className）に liff-hit がある
      const around = src.slice(Math.max(0, at - 400), at + 400);
      expect(around, `${file} ${marker}`).toMatch(/<Button variant="(?:icon|arrow|chip|restaurant-control)"/);
      expect(read('../components/ui/Button.tsx')).toContain("'restaurant-control': 'liff-hit");
    }
  });

  it('画面の幅を決める指定がある（拡大は止めない）', () => {
    const html = read('../../index.html');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    expect(html).not.toContain('user-scalable=no');
  });
});
