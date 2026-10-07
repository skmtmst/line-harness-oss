/** URLは表示・貼り付け専用。サーバーからこのURLにアクセスしない。 */
export function safeRestaurantHttpsUrl(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function restaurantReservationEmbed(base: string, token: string) {
  const url = new URL(`/restaurant/reserve/${encodeURIComponent(token)}`, base).href;
  const escaped = url.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return { url, html: `<a href="${escaped}" target="_blank" rel="noopener noreferrer">LINEで予約する</a>`, available: true as const };
}
