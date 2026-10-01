/**
 * M (止めた流入経路の QR): 印刷用 PDF をサーバーで組み立てる。
 *
 * ブラウザの印刷に頼らず、Worker が A4・1枚の PDF を返す。外部サービスへは
 * 何も送らない。依存を増やさないため、PDF の骨組みは自前で書く。
 *
 * 描けるもの: QR の升目(ベクターの四角。印刷しても読み取れる)、URL と
 * 発行日時の英数字文(Helvetica)。日本語の店名・ヒントは、埋め込む
 * フォント資産が無いため本文には描けない。代わりに文書情報(`/Title`・
 * `/Subject`・`/Keywords`。閲覧ソフトの表題に出る)とファイル名に残す。
 * 店名を紙面に出す対応(フォント資産の用意か、画面描画の埋め込み)は
 * 後の課題として報告に残す。
 */

import type { QrSymbol } from './qr-matrix.js';

/** A4 の大きさ(pt)。 */
export const QR_PDF_PAGE_WIDTH = 595.28;
export const QR_PDF_PAGE_HEIGHT = 841.89;

export interface QrPrintSheetInput {
  /** 店名。文書情報とファイル名に残す(本文には描けない。上記コメント)。 */
  accountName: string;
  /** QR にする URL。ASCII だけ受け付ける(経路 URL は ASCII で作る)。 */
  url: string;
  /** 発行日時(日本語表記のまま。ASCII だけ受け付ける)。例: `2026-09-27 15:00`。 */
  issuedAt: string;
  qr: QrSymbol;
}

/** PDF に載せられないときに投げる。利用者には 400 で返す。 */
export class QrPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrPdfError';
  }
}

function assertPrintableAscii(value: string, label: string): void {
  if (!/^[\x20-\x7E]*$/.test(value)) {
    throw new QrPdfError(`${label}に PDF へ直接書けない文字が含まれています`);
  }
}

function escapeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** 文書情報用の UTF-16BE 16進。閲覧ソフトが表題に使う。 */
export function utf16beHex(value: string): string {
  let out = 'FEFF';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code <= 0xffff) {
      out += code.toString(16).padStart(4, '0');
    } else {
      const rest = code - 0x10000;
      out += ((rest >> 10) + 0xd800).toString(16).padStart(4, '0');
      out += ((rest & 0x3ff) + 0xdc00).toString(16).padStart(4, '0');
    }
  }
  return out.toUpperCase();
}

/**
 * A4・1枚の PDF を組み立てる。QR は升目をそのまま四角で描く。
 * 1モジュールが潰れないよう、紙面の中央に 360pt 四方で置く。
 */
export function buildQrPrintPdf(input: QrPrintSheetInput): Uint8Array {
  assertPrintableAscii(input.url, 'URL');
  assertPrintableAscii(input.issuedAt, '発行日時');
  if (input.qr.size <= 0) throw new QrPdfError('QR の升目がありません');

  const qrSize = 360;
  const cells = input.qr.size;
  const module = qrSize / cells;
  const qrX = (QR_PDF_PAGE_WIDTH - qrSize) / 2;
  const qrTop = QR_PDF_PAGE_HEIGHT - 140;
  const qrY = qrTop - qrSize;

  const lines: string[] = [];
  lines.push('0.09 0.09 0.09 rg');
  const { modules } = input.qr;
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      if (modules[y * cells + x] !== 1) continue;
      // PDF の y は下が 0。QR の上行から下へ積む。
      const rectY = qrY + (cells - 1 - y) * module;
      lines.push(`${qrX + x * module} ${rectY} ${module} ${module} re f`);
    }
  }
  lines.push('0 0 0 rg');
  lines.push('BT /F1 10 Tf');
  lines.push(`1 0 0 1 72 ${qrY - 32} Tm (${escapeLiteral(input.url)}) Tj`);
  lines.push('ET');
  lines.push('BT /F1 9 Tf');
  lines.push(`1 0 0 1 72 64 Tm (Issued ${escapeLiteral(input.issuedAt)}) Tj`);
  lines.push('ET');
  const content = lines.join('\n');

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${QR_PDF_PAGE_WIDTH} ${QR_PDF_PAGE_HEIGHT}]`
    + ' /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objects.push(
    `<< /Title <${utf16beHex(`${input.accountName} 友だち追加QRコード`)}>`
    + ` /Subject <${utf16beHex(input.url)}>`
    + ` /Creator <${utf16beHex('musubo')}> >>`,
  );

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode('%PDF-1.4\n')];
  const offsets: number[] = [];
  let position = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(position);
    const bytes = encoder.encode(`${index + 1} 0 obj\n${body}\nendobj\n`);
    parts.push(bytes);
    position += bytes.length;
  });
  const xrefPosition = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n`
    + `startxref\n${xrefPosition}\n%%EOF`;
  parts.push(encoder.encode(xref));

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
