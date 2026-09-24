import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('V6正本 37-2 然・マイページ', () => {
  it('keeps the canonical header and bottom navigation labels', () => {
    expect(main).toContain('<header className="nm-home-header">');
    expect(main).toContain('<h1>マイページ</h1><span>然 -NEN-</span>');
    expect(main).toContain("{ value: 'pets', label: 'マイペット' }");
    expect(main).toContain("{ value: 'health', label: '健康日記' }");
    expect(main).toContain("{ value: 'orders', label: '注文・定期' }");
    expect(main).not.toContain('className="nm-member-header"');
    expect(main).not.toContain('NEN MEMBERS</p>');
  });

  it('keeps the 390px V6 canvas, white cards, and canonical tokens', () => {
    expect(styles).toContain('.nm-app { max-width: 390px;');
    expect(styles).toContain('.nm-home-header { display: grid; gap: 4px; padding: 18px 20px 14px; background: #fff; }');
    expect(styles).toContain('border: 1px solid #dadde2; border-radius: 10px; background: #fff;');
    expect(styles).toContain('.nm-home-stack { gap: 14px; padding: 14px 16px 96px; }');
    expect(styles).toContain('.nm-bottom-nav { position: fixed;');
    expect(styles).toContain('max-width: 390px;');
    expect(styles).not.toContain('.nm-member-header {');
  });
});

describe('V6正本 37-2-C 然・投稿', () => {
  it('uses the adopted design node and the three review labels', () => {
    expect(main).toContain('data-design-node="pNuzE"');
    expect(main).toContain("pending: '審査中'");
    expect(main).toContain("adopted: '採用'");
    expect(main).toContain("rejected: '見送り'");
  });

  it('keeps consent, reward, and empty-state wording in the LIFF view', () => {
    expect(main).toContain('サイトへの掲載に同意する');
    expect(main).toContain('同意していない写真は公式サイトに掲載されません');
    expect(main).toContain('5マイル付与');
    expect(main).toContain('まだ投稿がありません');
    expect(main).not.toContain('5ポイント');
  });

  it('keeps tall previews fully visible and uses variables for the new palette', () => {
    expect(styles).toContain('.nm-photo-preview-frame img');
    expect(styles).toContain('object-fit: contain;');
    expect(styles).toContain('--photo-');
  });
});
