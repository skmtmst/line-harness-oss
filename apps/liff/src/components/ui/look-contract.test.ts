import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(HERE, '..', '..');
const src = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');
const css = src('index.css');
const html = src('..', 'index.html');

/*
 * M2 LIFF の見た目の型 (V8.pen 修正案 L-2・L-3。値は色見本どおり) の契約。
 * 流儀は feel-contract と同じ (描画試験はしない。文面を読む)。
 * ⑤ LINE らしい (＝今の見た目そのまま) は型の上書きを持たない。
 * 司令塔の直し：⑤の主は #03873a のまま・③の主は #b5532f (白字 4.95)・
 * ②の主は真っ黒を避けた #2b2d31。角丸・見出し・数字は一括で当てる。
 */

function themeBlock(theme: string): string {
  const m = css.match(new RegExp(`\\[data-liff-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`theme block missing: ${theme}`);
  return m[1];
}

describe('5つの型は CSS 変数の組 (色見本どおり)', () => {
  it('①ナチュラル (地 #fbfaf7・面 #ffffff・主 #123d2f・しっぽり明朝・角丸 23)', () => {
    const block = themeBlock('natural');
    expect(block).toContain('--color-canvas: #fbfaf7');
    expect(block).toContain('--color-ground: #ffffff');
    expect(block).toContain('--color-liff-line: #e9e4dc');
    expect(block).toContain('--color-liff-sub: #76716a');
    expect(block).toContain('--color-ink: #1a1a1a');
    expect(block).toContain('--color-liff-primary: #123d2f');
    expect(block).toContain('--liff-on-primary: #ffffff');
    expect(block).toContain('--color-liff-dot-few: #c9a96a');
    expect(block).toContain('--color-liff-full: #c4beb4');
    expect(block).toContain('Shippori Mincho');
    expect(block).toContain('--liff-radius: 23px');
    expect(block).toContain('--liff-radius-lg: 23px');
  });

  it('②モダン (主 #2b2d31・見出し Noto 800・角丸 10)', () => {
    const block = themeBlock('modern');
    expect(block).toContain('--color-canvas: #ffffff');
    expect(block).toContain('--color-ground: #f5f5f5');
    expect(block).toContain('--color-ink: #111111');
    expect(block).toContain('--color-liff-primary: #2b2d31');
    expect(block).toContain('--liff-on-primary: #ffffff');
    expect(block).toContain('--color-liff-dot-few: #ff9f0a');
    expect(block).toContain('--color-liff-full: #c7c7cc');
    expect(block).toContain('--liff-radius: 10px');
    // 真っ黒は使わない (オーナー)。
    expect(block).not.toMatch(/#000\b/);
    expect(block).not.toContain('#000000');
    // 見出しは Noto Sans JP の 800。
    expect(css).toContain('[data-liff-theme="modern"] h1');
    expect(css).toContain('font-weight: 800');
  });

  it('③やさしい (主 #b5532f・Zen Maru Gothic・角丸 21)', () => {
    const block = themeBlock('gentle');
    expect(block).toContain('--color-canvas: #fff8f3');
    expect(block).toContain('--color-ink: #3b2a22');
    expect(block).toContain('--color-liff-primary: #b5532f');
    expect(block).toContain('--liff-on-primary: #ffffff');
    expect(block).toContain('--color-liff-dot-few: #e8b04a');
    expect(block).toContain('--color-liff-full: #d6c6bb');
    expect(block).toContain('Zen Maru Gothic');
    expect(block).toContain('--liff-radius: 21px');
  });

  it('④夜は深い紺 (主は金・字は紺・黒は使わない・角丸 23)', () => {
    const block = themeBlock('night');
    expect(block).toContain('--color-canvas: #0f1c33');
    expect(block).toContain('--color-ground: #172a47');
    expect(block).toContain('--color-liff-line: #27406a');
    expect(block).toContain('--color-liff-sub: #a9b8d0');
    expect(block).toContain('--color-ink: #f2f5fa');
    expect(block).toContain('--color-liff-primary: #c9a96a');
    expect(block).toContain('--liff-on-primary: #0f1c33');
    expect(block).toContain('--color-liff-dot-few: #e0c48a');
    expect(block).toContain('--color-liff-full: #4a5f82');
    expect(block).toContain('Shippori Mincho');
    expect(block).toContain('--liff-radius: 23px');
    // オーナー：黒は使わない。
    expect(block).not.toMatch(/#000\b/);
    expect(block).not.toContain('#000000');
  });

  it('⑤ LINE らしいに専用の上書きは無い (今の見た目のまま)', () => {
    expect(css).not.toContain('[data-liff-theme="line"]');
    // 土台の主の色は LIFF 専用の濃い緑のまま。
    expect(css).toContain('--color-liff-primary: #03873a');
  });
});

describe('型を替えても壊れない決まり', () => {
  it('知らせ (注意書きの箱) はどの型でも白地のまま', () => {
    for (const theme of ['natural', 'modern', 'gentle', 'night']) {
      expect(themeBlock(theme)).not.toContain('--color-liff-note');
    }
  });

  it('主の色の上の字は既定で白。店の色で上書きする', () => {
    expect(css).toContain('--liff-on-primary: #ffffff');
  });

  it('見出しの書体は型・店の設定で替える', () => {
    expect(css).toContain('--liff-font-heading');
  });

  it('数字の書体は型ごとに替える (liff-num)', () => {
    expect(css).toContain('.liff-num');
    expect(css).toContain('font-weight: 300');
    expect(css).toContain('font-weight: 500');
  });

  it('角丸の素は今の値が既定 (10・箱は14)', () => {
    expect(css).toContain('--liff-radius: 10px');
    expect(css).toContain('--liff-radius-lg: 14px');
  });
});

describe('書体の読み込み', () => {
  it('しっぽり明朝と Zen Maru Gothic を読む。数字の 300 と見出しの 800 も足す', () => {
    expect(html).toContain('Shippori+Mincho');
    expect(html).toContain('Zen+Maru+Gothic');
    expect(html).toContain('Inter:wght@300');
    expect(html).toContain('Noto+Sans+JP:wght@400;500;600;700;800');
    // 今の Inter・Noto Sans JP も残す。
    expect(html).toContain('Noto+Sans+JP');
  });
});
