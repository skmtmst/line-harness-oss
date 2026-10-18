/** Durable customer links carry a resource ID, never a credential/capability. */
export function customerDownloadEntry(origin: string, kind: 'files' | 'statements', id: string): string {
  return new URL(`/liff/${kind}/${encodeURIComponent(id)}`, origin).toString();
}

/** Only a configured LINE LIFF ID can select the destination. No caller URLs. */
export function customerLiffDownload(liffId: string | null | undefined, kind: 'files' | 'statements', id: string): string | null {
  if (!liffId || !/^[\w-]+$/.test(liffId)) return null;
  const url = new URL(`https://liff.line.me/${liffId}/${kind}/`);
  url.searchParams.set('id', id);
  // The shared LIFF bootstrap selects the app from this public identifier.
  url.searchParams.set('liffId', liffId);
  return url.toString();
}

export const privateDownloadHeaders = {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
};
