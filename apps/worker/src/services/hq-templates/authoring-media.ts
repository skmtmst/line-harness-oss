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
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}(?:\/(?:240|300|460|700|1040))?$/.test(rest)) error('INVALID_IMAGE');
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

/** LINEイメージマップ用5サイズ。統括の登録画像からだけ作り、配布時は全サイズをコピーする。 */
export async function uploadHqImagemap(env: import('../../index.js').Env['Bindings'], authority: HqTemplateAuthority, request: Request, origin: string): Promise<import('@line-crm/shared').TemplateImagemapUpload> {
  if (!env.CF_IMAGES) error('IMAGE_TRANSFORM_UNAVAILABLE');
  const url=new URL(request.url); url.searchParams.set('purpose','message');
  const source=await uploadHqImage(env.IMAGES,authority,new Request(url,request),origin);
  const object=await env.IMAGES.get(source.r2Key);
  if(!object || !('body' in object)) error('INVALID_IMAGE');
  const bytes=await readMessageTemplateSourceBytes(object!.body,source.sizeBytes);
  const height=Math.round(source.height! / source.width! * 1040),group=crypto.randomUUID();
  const baseKey=`hq-templates/${authority.tenantId}/uploads/${group}`;
  const media: MessageTemplateMediaDefinition[]=[];
  let total=0;
  try {
    for(const width of [240,300,460,700,1040]) {
      const h=Math.max(1,Math.round(height * width/1040));
      const output=await env.CF_IMAGES!.input(new Blob([bytes]).stream()).transform({width,height:h,fit:'squeeze'}).output({format:'image/png'});
      const resized=await readMessageTemplateSourceBytes(output.image(),8*1024*1024);
      total+=resized.length;
      if(!resized.length || total>16*1024*1024) error('MEDIA_SIZE_LIMIT');
      const r2Key=`${baseKey}/${width}`,id=crypto.randomUUID(),contentHash=await hash(resized);
      const m:MessageTemplateMediaDefinition={...source,id,filename:`${group}-${width}.png`,width,height:h,r2Key,publicUrl:`${new URL(origin).origin}/images/${r2Key}`,versionId:id,sizeBytes:resized.length,mimeType:'image/png',contentHash};
      media.push(m);
      const saved=await env.IMAGES.put(r2Key,resized,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:m.mimeType},customMetadata:{hqTenant:authority.tenantId,hqMedia:JSON.stringify(m)}});
      if(!saved || !isRegisteredHqMedia(await env.IMAGES.head(r2Key),m,authority.tenantId)) error('UPLOAD_UNCONFIRMED');
    }
  } catch(e) {
    for(const m of media) if(isRegisteredHqMedia(await env.IMAGES.head(m.r2Key),m,authority.tenantId)) await env.IMAGES.delete(m.r2Key);
    throw e;
  }
  return {media,payload:{imageUrl:media.at(-1)!.publicUrl,baseUrl:`${new URL(origin).origin}/images/${baseKey}`,baseSize:{width:1040,height}}};
}
