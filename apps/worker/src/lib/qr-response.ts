/**
 * QRとして出せる形式。
 *
 * 上流（api.qrserver.com）はもっと受けるが、こちらから渡す値は
 * 名前で挙げたものだけにする。クエリをそのまま上流へ流すと、
 * 画面に無い形式や壊れた値がそのまま外へ出る。
 *
 * 印刷に使うなら svg。拡大しても粗くならない。png は画面と
 * ほとんどの入稿用、jpg は png を受け付けない古い入稿用。
 */
export const QR_FORMATS = ['png', 'svg', 'jpg'] as const;

export type QrFormat = (typeof QR_FORMATS)[number];

/** 画面から来た形式を、扱える値に丸める。知らない値は png に落とす。 */
export function normalizeQrFormat(raw: string | undefined): QrFormat {
  const v = (raw ?? '').toLowerCase();
  return (QR_FORMATS as readonly string[]).includes(v) ? (v as QrFormat) : 'png';
}

export function normalizeQrSize(raw: string | undefined): string | null {
  const size = raw || '240x240';
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(size);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 64 || width > 1024 || height < 64 || height > 1024 || width * height > 1_048_576) {
    return null;
  }
  return size;
}

export function isQrDataAllowed(data: string): boolean {
  return new TextEncoder().encode(data).byteLength <= 2048;
}

export function qrResponseHeaders(
  contentType: string | null,
  download: boolean,
  requestedName: string,
  format: QrFormat = 'png',
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType || 'image/png',
    'Cache-Control': 'public, max-age=86400',
  };
  if (download) {
    const safeName = requestedName.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'referral-link-qr';
    // 拡張子は実際に返す形式に合わせる。svg を .png で保存させると、
    // 開けないファイルが手元に残る。
    headers['Content-Disposition'] = `attachment; filename="${safeName}.${format}"`;
  }
  return headers;
}
