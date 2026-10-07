/**
 * お客さまに見せる失敗の文。
 *
 * サーバーが返す日本語の案内（「この枠は埋まりました」など）はそのまま出す。
 * 英語の内部の文（`Failed to fetch`・`API error: 500`・`TypeError: …`）や
 * HTTP の番号だけの文は出さず、画面ごとの日本語の案内に置き換える。
 */
const JAPANESE = /[぀-ヿ㐀-鿿]/;
const INTERNAL = /API error|HTTP\s*\d{3}|Error:|Failed to fetch|NetworkError|Load failed|undefined|null/i;

export function customerMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!message || !JAPANESE.test(message) || INTERNAL.test(message)) return fallback;
  return message;
}
