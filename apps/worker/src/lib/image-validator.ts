// Lightweight PNG/JPEG header parser to validate LINE rich menu images
// without external dependencies (runs on Cloudflare Workers).
//
// LINE のリッチメニュー画像規定 (v1):
//   Large   2500 x 1686
//   Compact 2500 x 843
//   PNG / JPEG, 1MB 以下

import { RICH_MENU_DIMENSIONS, type RichMenuSize } from '@line-crm/shared';

export type ImageMeta = {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
};

export type { RichMenuSize } from '@line-crm/shared';

export type ValidationResult =
  | { ok: true; size: RichMenuSize; format: 'png' | 'jpeg' }
  | { ok: false; error: string };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const MAX_FILE_BYTES = 1024 * 1024;

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIG.length) return false;
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (bytes[i] !== PNG_SIG[i]) return false;
  }
  return true;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

export function detectImageMeta(bytes: Uint8Array): ImageMeta | null {
  if (isPng(bytes)) {
    if (bytes.length < 24) return null;
    // IHDR is the first chunk; width/height live at offsets 16..23.
    const width = readUint32BE(bytes, 16);
    const height = readUint32BE(bytes, 20);
    return { format: 'png', width, height };
  }
  if (isJpeg(bytes)) {
    // Walk JFIF segments looking for SOF0/SOF2 (start of frame markers).
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = readUint16BE(bytes, i + 5);
        const width = readUint16BE(bytes, i + 7);
        return { format: 'jpeg', width, height };
      }
      // Skip the segment using its declared length.
      const segLen = readUint16BE(bytes, i + 2);
      if (segLen < 2) return null;
      i += 2 + segLen;
    }
    return null;
  }
  return null;
}

export function validateRichMenuImage(bytes: Uint8Array, fileSize: number): ValidationResult {
  if (fileSize > MAX_FILE_BYTES) {
    return { ok: false, error: `file size ${fileSize} exceeds 1MB limit` };
  }
  const meta = detectImageMeta(bytes);
  if (!meta) {
    return { ok: false, error: 'unrecognized image format (PNG or JPEG only)' };
  }
  for (const [size, dims] of Object.entries(RICH_MENU_DIMENSIONS) as [RichMenuSize, { width: number; height: number }][]) {
    if (meta.width === dims.width && meta.height === dims.height) {
      return { ok: true, size, format: meta.format };
    }
  }
  return {
    ok: false,
    error: `dimensions ${meta.width}x${meta.height} are not supported (need ${RICH_MENU_DIMENSIONS.large.width}x${RICH_MENU_DIMENSIONS.large.height} or ${RICH_MENU_DIMENSIONS.compact.width}x${RICH_MENU_DIMENSIONS.compact.height})`,
  };
}
