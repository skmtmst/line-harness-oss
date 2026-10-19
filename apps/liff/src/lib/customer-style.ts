import type { AccountStyle } from '@line-crm/shared';
/** 正式な業種は所属を確認した公開APIからだけ受け取る。URLや端末には保存しない。 */
export type CustomerStyle = AccountStyle;

export function parseCustomerStyle(value: unknown): CustomerStyle {
  switch (value) {
    case 'standard': case 'ec': case 'restaurant': case 'salon': case 'consult': case 'lesson':
      return value;
    default: throw new Error('customer_style_unavailable');
  }
}

/** 言葉の正本は terms.md §5/6。公開の正式キーを画面の語へ写す境界。 */
export function customerWords(style: CustomerStyle | null) {
  const consult = style === 'consult', lesson = style === 'lesson';
  const onsite = style !== null && !consult;
  return {
    bookingContent: consult ? '面談の種類' : lesson ? 'クラス' : style === 'restaurant' ? 'コース' : style ? 'メニュー' : '予約内容',
    bookingTitle: consult ? '面談の予約' : 'ご予約',
    approvalPending: consult || lesson ? '確認待ち' : onsite ? 'お店の確認待ち' : '担当者の確認待ち',
    payOnsite: onsite ? 'お店で払う' : '当日払う',
    contact: consult ? '担当' : lesson ? '教室' : style ? 'お店' : 'ご利用先',
    event: lesson ? 'クラス' : 'イベント',
    myEvents: lesson ? '自分のクラス' : '自分のイベント',
    staff: lesson ? '講師' : '担当',
    completed: consult ? '面談済み' : lesson ? '出席' : style ? 'ご来店済み' : '完了',
    noShow: consult || lesson ? '欠席' : style ? 'ご来店なし' : '欠席',
    selfService: '期限内の予約は、各予約のボタンから日時の変更・キャンセルができます。期限後はトークでご連絡ください。',
  };
}
