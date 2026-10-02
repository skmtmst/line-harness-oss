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

describe('V6正本 37-2-D 然・注文・定期', () => {
  it('uses the adopted design node and the canonical header', () => {
    expect(main).toContain('data-design-node="sBTL8"');
    expect(main).toContain('<h1>注文・定期</h1><span>然 -NEN-</span>');
    expect(main).toContain('お届けと購入履歴をまとめて確認');
    expect(main).toContain('ホームの「最近の注文」から開いた注文も、こちらにまとまっています。');
  });

  it('keeps subscription details, EC guidance, and both empty states', () => {
    expect(main).toContain('定期便の契約状況');
    expect(main).toContain('現在の状況');
    expect(main).toContain('次回お届け');
    expect(main).toContain('お届け周期');
    expect(main).toContain('変更・スキップ・解約はこの画面では行いません。お手続きはECのマイページからお願いします。');
    expect(main).toContain('ECのマイページへ');
    expect(main).toContain('契約中の定期便はありません');
    expect(main).toContain('通常購入の履歴はまだありません');
  });

  it('keeps order detail and repeat-purchase links without point wording', () => {
    expect(main).toContain('注文番号');
    expect(main).toContain('もう一度購入');
    expect(main).toContain('注文内容を見る');
    const ordersView = main.slice(main.indexOf('function OrdersView'), main.indexOf('const yen'));
    expect(ordersView).not.toContain('ポイント');
  });

  it('uses V6 variables for the order palette', () => {
    expect(styles).toContain('.nm-orders-page-v6 { color: var(--order-ink); }');
    expect(styles).toContain('--order-accent: var(--photo-accent);');
    expect(styles).toContain('/* ★V6正本 sBTL8:');
    const orderStyles = styles.slice(styles.indexOf('/* ★V6正本 sBTL8:'), styles.indexOf('/* ★V6正本 pNuzE:'));
    expect(orderStyles).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
