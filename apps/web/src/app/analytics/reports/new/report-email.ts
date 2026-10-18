/*
 * メールアドレスの形の検査。裏側（apps/worker/src/routes/analytics.ts の
 * isEmail）と同じ式で、同じ行を同じ理由で止める。以前は画面で止めずに
 * 裏側が黙って落としていたので、1件でも不備があれば送信しない。
 */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}
