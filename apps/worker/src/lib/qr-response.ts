export function qrResponseHeaders(
  contentType: string | null,
  download: boolean,
  requestedName: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType || 'image/png',
    'Cache-Control': 'public, max-age=86400',
  };
  if (download) {
    const safeName = requestedName.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'referral-link-qr';
    headers['Content-Disposition'] = `attachment; filename="${safeName}.png"`;
  }
  return headers;
}
