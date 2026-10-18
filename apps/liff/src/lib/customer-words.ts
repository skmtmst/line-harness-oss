/** 公開APIに業種が無い画面では、面談・教室でも通じる言葉を使う。店名は推測しない。 */
export const CUSTOMER_WORDS = {
  bookingContent: '予約内容',
  approvalPending: '担当者の確認待ち',
  payOnsite: '当日払う',
  selfService: '期限内の予約は、各予約のボタンから日時の変更・キャンセルができます。期限後はトークでご連絡ください。',
} as const;

export const PAYMENT_PREPARING_TITLE = 'カード決済は準備中です';
export const PAYMENT_PREPARING_BODY = 'いまは試験用のお支払いです。実際の請求・返金は行われません。支払い方法はトークでご確認ください。';
export const PAYMENT_UNKNOWN = '支払いの結果を確認できていません。もう一度支払わず、トークで担当者へご連絡ください。';
