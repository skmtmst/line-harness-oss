import { navigationProof } from '../lib/navigation-proof.js';

/** 実 OAuth 開始が発行する、署名付き state とブラウザ Cookie を再現する。 */
export async function signedLiffState(secret: string, data: Record<string, string>) {
  const nonce = 'test-browser-nonce';
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ data: JSON.stringify(data), nonce, expires: Date.now() + 600_000 }))));
  return { state: `${payload}.${await navigationProof(secret, 'liff-oauth', payload)}`, cookie: `lh_liff_oauth=${nonce}` };
}

/** JWT の形だけの fixture なので、LINE の検証応答は別途差し替える必要がある。 */
export function mockLineIdToken(channelId: string): string {
  return `fixture.${btoa(JSON.stringify({ aud: channelId }))}.signature`;
}
