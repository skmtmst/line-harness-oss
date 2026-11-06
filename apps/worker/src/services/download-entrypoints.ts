/** 長期の顧客リンクはリソース ID だけを持ち、資格情報や権限票を載せない。 */
export function customerDownloadEntry(origin: string, kind: 'files' | 'statements', id: string): string {
  return new URL(`/liff/${kind}/${encodeURIComponent(id)}`, origin).toString();
}

/** 利用者指定の URL でなく、設定済み LINE LIFF ID だけから移動先を決める。 */
export function customerLiffDownload(liffId: string | null | undefined, kind: 'files' | 'statements', id: string): string | null {
  if (!liffId || !/^[\w-]+$/.test(liffId)) return null;
  const url = new URL(`https://liff.line.me/${liffId}/${kind}/`);
  url.searchParams.set('id', id);
  // 共通の LIFF 初期化は、この公開識別子から対象画面を選ぶ。
  url.searchParams.set('liffId', liffId);
  return url.toString();
}

export const privateDownloadHeaders = {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
};
