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
 * M2 LIFF の見た目の型 (V8.pen 修正案 L-2・L-3) の契約。
 * 流儀は feel-contract と同じ (描画試験はしない。文面を読む)。
 * ⑤ LINE らしい (今の見た目) は型の上書きを持たない。
 */

function themeBlock(theme: string): string {
  const m = css.match(new RegExp(`\\[data-liff-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`theme block missing: ${theme}`);
  return m[1];
}

describe('5つの型は CSS 変数の組', () => {
  it('①ナチュラル (生成り・しっぽり明朝・深い緑 #123d2f)', () => {
    const block = themeBlock('natural');
    expect(block).toContain('#123d2f');
    expect(block).toContain('Shippori Mincho');
  });

  it('②モダン (白黒すっきり。主の色は墨＝--color-ink の値だけ)', () => {
    const block = themeBlock('modern');
    expect(block).toContain('--color-liff-primary: #1d1d1f');
  });

  it('③やさしい (Zen Maru Gothic・テラコッタ)', () => {
    const block = themeBlock('gentle');
    expect(block).toContain('Zen Maru Gothic');
    expect(block).toContain('--color-liff-primary: #b25f42');
  });

  it('④夜は深い紺 (黒は使わない)', () => {
    const block = themeBlock('night');
    expect(block).toContain('#0f1c33');
    expect(block).toContain('#172a47');
    expect(block).toContain('#27406a');
    expect(block).toContain('#a9b8d0');
    expect(block).toContain('#f2f5fa');
    expect(block).toContain('#c9a96a');
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
});

describe('書体の読み込み', () => {
  it('しっぽり明朝と Zen Maru Gothic を読む', () => {
    expect(html).toContain('Shippori+Mincho');
    expect(html).toContain('Zen+Maru+Gothic');
    // 今の Inter・Noto Sans JP も残す。
    expect(html).toContain('Noto+Sans+JP');
  });
});
