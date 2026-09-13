import { encodeQr, QrInputError } from './qr-matrix.js';
import { renderQrJpeg, renderQrPng, renderQrSvg } from './qr-image.js';

export { QrInputError };

/**
 * QRとして出せる形式。
 *
 * 画面から来た値をそのまま使わず、名前で挙げたものだけにする。
 * 知らない形式を通すと、描き分けの無い分岐へ落ちる。
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

/** 返してよい画像の上限。ここを超えたら作り方を疑う。 */
export const QR_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface QrImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/**
 * 正規化済みの size / format から QR 画像を作る。
 *
 * ここが外部へ出ていく唯一の場所だった。流入 ref や LIFF URL を
 * 第三者の生成サービスへ渡していたので、Worker の中だけで作るようにした。
 * この関数は fetch を呼ばない。
 *
 * @throws {QrInputError} 指定の大きさに収まらない・長すぎるとき。
 */
export async function createQrImage(data: string, size: string, format: QrFormat): Promise<QrImage> {
  const [width, height] = size.split('x').map(Number);
  const symbol = encodeQr(data);
  if (format === 'svg') {
    return {
      bytes: new TextEncoder().encode(renderQrSvg(symbol, width, height)),
      contentType: 'image/svg+xml',
    };
  }
  if (format === 'jpg') {
    return { bytes: renderQrJpeg(symbol, width, height), contentType: 'image/jpeg' };
  }
  return { bytes: await renderQrPng(symbol, width, height), contentType: 'image/png' };
}
