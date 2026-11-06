const BASE = import.meta.env.VITE_API_BASE ?? '';

/** 本人用の読み取り。資格情報を URL・参照元・キャッシュへ残さない。 */
export function fetchAffiliateSelf(path: string, accessToken: string): Promise<Response> {
  if (!accessToken) throw new Error('LINEで開き直してください');
  return fetch(new URL(`${BASE}/api/liff/${path}`, window.location.origin), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
  });
}
