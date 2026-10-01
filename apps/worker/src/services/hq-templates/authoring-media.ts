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

const dimensionParam = (value: string | null): number | null => {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) error('INVALID_IMAGE');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20000) error('INVALID_IMAGE');
  return parsed;
};

/** Authenticated raw upload. No fetch-by-URL, client-selected key or account credential. */
export async function uploadHqImage(bucket: R2Bucket, authority: HqTemplateAuthority, request: Request, publicBaseUrl: string) {
  if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED' || !/^[A-Za-z0-9_-]{1,128}$/.test(authority.tenantId)) error('FORBIDDEN');
  const url = new URL(request.url), purpose = url.searchParams.get('purpose'), filename = url.searchParams.get('filename') ?? '';
  if (!['message', 'rich_menu'].includes(purpose ?? '') || !filename.trim() || filename.length > 200 || /[\\/\u0000-\u001f]/.test(filename)) error('INVALID_IMAGE');
  // R568: the editor tells which size it can adopt. A declared size that the
  // image does not match is rejected here, before any R2 write.
  const expectedWidth = dimensionParam(url.searchParams.get('width')), expectedHeight = dimensionParam(url.searchParams.get('height'));
  if ((expectedWidth === null) !== (expectedHeight === null)) error('INVALID_IMAGE');
  const max = purpose === 'rich_menu' ? 1024 * 1024 : 8 * 1024 * 1024;
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max || Number(declared) < 1)) error('MEDIA_SIZE_LIMIT');
  if (!request.body) error('INVALID_IMAGE');
  const bytes = await readMessageTemplateSourceBytes(request.body!, max), image = detectImageMeta(bytes);
  if (!image || !image.width || !image.height || image.width > 20000 || image.height > 20000) error('INVALID_IMAGE');
  const mimeType = image!.format === 'png' ? 'image/png' : 'image/jpeg';
  if (request.headers.get('content-type') !== mimeType) error('INVALID_IMAGE');
  if (purpose === 'rich_menu' && !validateRichMenuImage(bytes, bytes.length).ok) error('INVALID_RICH_MENU_IMAGE');
  if (purpose === 'rich_menu' && expectedWidth !== null && expectedHeight !== null && (image!.width !== expectedWidth || image!.height !== expectedHeight)) error('INVALID_RICH_MENU_IMAGE');
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

/**
 * R568: reclaim an upload that was never adopted (cancelled edit, replaced
 * image). Only the owning tenant's own uploads path can be removed, and only
 * after the stored ownership mark is verified. Missing objects are a
 * successful no-op so cancel cleanup stays idempotent; anything outside the
 * caller's ownership is NOT_FOUND without revealing what exists.
 */
export async function deleteHqImage(bucket: R2Bucket, authority: HqTemplateAuthority, r2Key: unknown): Promise<{ deleted: boolean }> {
  if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED' || !/^[A-Za-z0-9_-]{1,128}$/.test(authority.tenantId)) error('FORBIDDEN');
  const key = typeof r2Key === 'string' ? r2Key : '';
  if (key.length < 1 || key.length > 400) error('INVALID_IMAGE');
  const prefix = `hq-templates/${authority.tenantId}/uploads/`;
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(rest)) error('INVALID_IMAGE');
  const object = await bucket.head(key);
  if (!object) return { deleted: false };
  const stored = object.customMetadata ?? {};
  if (stored.hqTenant !== authority.tenantId) error('NOT_FOUND');
  let registered = false;
  try {
    const manifest: unknown = JSON.parse(stored.hqMedia ?? 'null');
    registered = Boolean(manifest) && typeof manifest === 'object';
  } catch { registered = false; }
  if (!registered) error('NOT_FOUND');
  await bucket.delete(key);
  return { deleted: true };
}
