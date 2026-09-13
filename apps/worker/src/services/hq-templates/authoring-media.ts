import { detectImageMeta, validateRichMenuImage } from '../../lib/image-validator.js';
import { requireHqTemplateAuthority, type HqTemplateAuthority } from './contract.js';
import { readMessageTemplateSourceBytes, TemplateHqTemplateError, type MessageTemplateMediaDefinition } from './template.js';

// This marker denotes an HQ-authored resource, not a synthetic line account.
// Runtime authority must still come from the immutable tenant-scoped HQ version.
export const HQ_AUTHORED_MESSAGE_ID = 'hq-authored-message';
const error = (code: string): never => { throw new TemplateHqTemplateError(code, 422); };
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

export function isRegisteredHqMedia(object: R2Object | null, media: MessageTemplateMediaDefinition, tenantId: string): boolean {
  if (!object || object.size !== media.sizeBytes || object.customMetadata?.hqTenant !== tenantId || object.httpMetadata?.contentType !== media.mimeType) return false;
  try {
    const manifest = JSON.parse(object.customMetadata.hqMedia ?? 'null');
    return Boolean(manifest) && Object.keys(media).every(key => manifest[key] === media[key as keyof MessageTemplateMediaDefinition]);
  } catch { return false; }
}

/** Authenticated raw upload. No fetch-by-URL, client-selected key or account credential. */
export async function uploadHqImage(bucket: R2Bucket, authority: HqTemplateAuthority, request: Request, publicBaseUrl: string) {
  if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED' || !/^[A-Za-z0-9_-]{1,128}$/.test(authority.tenantId)) error('FORBIDDEN');
  const url = new URL(request.url), purpose = url.searchParams.get('purpose'), filename = url.searchParams.get('filename') ?? '';
  if (!['message', 'rich_menu'].includes(purpose ?? '') || !filename.trim() || filename.length > 200 || /[\\/\u0000-\u001f]/.test(filename)) error('INVALID_IMAGE');
  const max = purpose === 'rich_menu' ? 1024 * 1024 : 8 * 1024 * 1024;
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max || Number(declared) < 1)) error('MEDIA_SIZE_LIMIT');
  if (!request.body) error('INVALID_IMAGE');
  const bytes = await readMessageTemplateSourceBytes(request.body!, max), image = detectImageMeta(bytes);
  if (!image || !image.width || !image.height || image.width > 20000 || image.height > 20000) error('INVALID_IMAGE');
  const mimeType = image!.format === 'png' ? 'image/png' : 'image/jpeg';
  if (request.headers.get('content-type') !== mimeType) error('INVALID_IMAGE');
  if (purpose === 'rich_menu' && !validateRichMenuImage(bytes, bytes.length).ok) error('INVALID_RICH_MENU_IMAGE');
  const origin = new URL(publicBaseUrl);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) error('INVALID_PUBLIC_ORIGIN');
  const contentHash = await hash(bytes), id = await hash(new TextEncoder().encode(JSON.stringify([authority.tenantId, purpose, filename, contentHash])));
  const r2Key = `hq-templates/${authority.tenantId}/uploads/${id}.${image!.format === 'png' ? 'png' : 'jpg'}`;
  const media: MessageTemplateMediaDefinition = { id, kind: 'image', filename, mimeType, sizeBytes: bytes.length, width: image!.width, height: image!.height, durationMs: null, r2Key, publicUrl: `${origin.origin}/images/${r2Key}`, versionId: id, versionNo: 1, contentHash };
  const existing = await bucket.head(r2Key);
  if (existing) {
    if (!isRegisteredHqMedia(existing, media, authority.tenantId)) error('SOURCE_MEDIA_UNAVAILABLE');
    return media;
  }
  // Immutable content-addressed key: retries recover the same receipt. Unknown PUT
  // outcomes never trigger destructive compensation or a different key.
  try {
    const saved = await bucket.put(r2Key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: mimeType }, customMetadata: { hqTenant: authority.tenantId, hqMedia: JSON.stringify(media) } });
    if (saved) return media;
  } catch { /* reconcile the exact key below */ }
  if (!isRegisteredHqMedia(await bucket.head(r2Key), media, authority.tenantId)) error('UPLOAD_UNCONFIRMED');
  return media;
}
