import { describe, expect, it } from 'vitest';
import { extractContactFormReceipt, paginateSupportInboxItems } from './support-inbox.js';

describe('paginateSupportInboxItems', () => {
  it('5件表示で6件目を2ページ目に出す', () => {
    expect(paginateSupportInboxItems(['1', '2', '3', '4', '5', '6'], 5, 5)).toEqual(['6']);
  });
});

describe('extractContactFormReceipt', () => {
  it('extracts the customer and only the submitted inquiry from the legacy receipt', () => {
    const result = extractContactFormReceipt(`※本メールは自動配信メールです。

坂本 真人 様

お名前：坂本 真人 (サカモト マサト) 様
メールアドレス：customer@example.com
お問い合わせ内容：

フォーム統合テスト
ECサイトのお問い合わせフォームから送信しています。`);

    expect(result).toEqual({
      customerEmail: 'customer@example.com',
      customerName: '坂本 真人',
      inquiry: 'フォーム統合テスト\nECサイトのお問い合わせフォームから送信しています。',
    });
  });

  it('removes the footer from the current receipt', () => {
    const result = extractContactFormReceipt(`お名前：山田 花子 様
メールアドレス：hanako@example.com

お問い合わせ内容：
商品の保存方法を教えてください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

本メールは自動配信のため返信できません。`);

    expect(result.inquiry).toBe('商品の保存方法を教えてください。');
  });
});
