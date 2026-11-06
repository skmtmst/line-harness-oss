import { customerWords } from './customer-style.js';
/** 公開APIに業種が無い画面では、面談・教室でも通じる言葉を使う。店名は推測しない。 */
export const CUSTOMER_WORDS = customerWords(null);

export const PAYMENT_PREPARING_TITLE = 'カード決済は準備中です';
export const PAYMENT_PREPARING_BODY = 'いまは試験用のお支払いです。実際の請求・返金は行われません。支払い方法はトークでご確認ください。';
export const PAYMENT_UNKNOWN = '支払いの結果を確認できていません。もう一度支払わず、トークで担当者へご連絡ください。';
