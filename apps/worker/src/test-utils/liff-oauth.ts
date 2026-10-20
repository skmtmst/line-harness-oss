import { navigationProof } from '../lib/navigation-proof.js';

/** Model the signed state and browser cookie issued by a real OAuth start. */
export async function signedLiffState(secret: string, data: Record<string, string>) {
  const nonce = 'test-browser-nonce';
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ data: JSON.stringify(data), nonce, expires: Date.now() + 600_000 }))));
  return { state: `${payload}.${await navigationProof(secret, 'liff-oauth', payload)}`, cookie: `lh_liff_oauth=${nonce}` };
}
