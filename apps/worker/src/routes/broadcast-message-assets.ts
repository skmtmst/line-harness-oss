import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  createBroadcastMessageAsset,
  deleteBroadcastMessageAsset,
  getBroadcastMessageAsset,
  listBroadcastMessageAssets,
  updateBroadcastMessageAsset,
  type BroadcastMessageAsset,
  type BroadcastMessageAssetKind,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { storeBroadcastMedia } from '../services/broadcast-media-storage.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';

const broadcastMessageAssets = new Hono<Env>();
const ASSET_KINDS = new Set<BroadcastMessageAssetKind>(['rich_message', 'card_message', 'coupon', 'research']);
const BROADCAST_MEDIA_TYPES = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], storedExtension: 'jpg' },
  'image/png': { extensions: ['png'], storedExtension: 'png' },
  'video/mp4': { extensions: ['mp4'], storedExtension: 'mp4' },
} as const;

type BroadcastMediaType = keyof typeof BROADCAST_MEDIA_TYPES;

function safeDecodeFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function detectedMediaType(bytes: Uint8Array): BroadcastMediaType | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12
    && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'video/mp4';
  }
  return null;
}

export function validateBroadcastMediaUpload(
  bytes: Uint8Array,
  declaredType: string,
  encodedFilename: string | undefined,
): { ok: true; mimeType: BroadcastMediaType; filename: string } | { ok: false; error: string } {
  if (!(declaredType in BROADCAST_MEDIA_TYPES)) {
    return { ok: false, error: 'JPEG・PNG・MP4のみアップロードできます' };
  }
  const actualType = detectedMediaType(bytes);
  if (!actualType || actualType !== declaredType) {
    return { ok: false, error: 'ファイルの内容と形式が一致しません' };
  }
  const filename = safeDecodeFilename(encodedFilename ?? '').trim();
  const extension = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  if (
    !extension ||
    !(BROADCAST_MEDIA_TYPES[actualType].extensions as readonly string[]).includes(extension)
  ) {
    return { ok: false, error: 'ファイル名の拡張子と内容が一致しません' };
  }
  return { ok: true, mimeType: actualType, filename };
}

async function readPrefix(stream: ReadableStream<Uint8Array>, length: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const bytes: number[] = [];
  try {
    while (bytes.length < length) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes.push(...chunk.value.slice(0, length - bytes.length));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Uint8Array.from(bytes);
}

async function adminAccountScope(c: Context<Env>) {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const where = scope.allowedAccountIds.length
    ? `(line_account_id IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.canSeeUnassigned ? ' OR line_account_id IS NULL' : ''})`
    : scope.canSeeUnassigned
      ? 'line_account_id IS NULL'
      : '1 = 0';
  return { scope, where };
}

const requireVisibleAsset: MiddlewareHandler<Env> = async (c, next) => {
  const asset = await getBroadcastMessageAsset(c.env.DB, c.req.param('id') ?? '');
  if (!asset || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [asset.line_account_id])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await next();
};

function serialize(row: BroadcastMessageAsset) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    kind: row.kind,
    name: row.name,
    payload: JSON.parse(row.payload_json) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePayload(kind: BroadcastMessageAssetKind, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload must be an object';
  const value = payload as Record<string, unknown>;
  if (kind === 'card_message') {
    if (!Array.isArray(value.cards) || value.cards.length < 1 || value.cards.length > 9) {
      return 'カードは1〜9枚で設定してください';
    }
  }
  if (kind === 'rich_message' && typeof value.imageUrl !== 'string') return '画像を設定してください';
  return null;
}

broadcastMessageAssets.get('/api/broadcast-message-assets', async (c) => {
  const kind = c.req.query('kind') as BroadcastMessageAssetKind | undefined;
  if (kind && !ASSET_KINDS.has(kind)) return c.json({ success: false, error: 'Invalid kind' }, 400);
  const lineAccountId = c.req.query('lineAccountId');
  if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  let rows = await listBroadcastMessageAssets(c.env.DB, lineAccountId, kind);
  const { scope } = await adminAccountScope(c);
  rows = rows.filter((row) => row.line_account_id === null
    ? scope.canSeeUnassigned
    : scope.allowedAccountIds.includes(row.line_account_id));
  return c.json({ success: true, data: rows.map(serialize) });
});

broadcastMessageAssets.post('/api/broadcast-message-assets', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ lineAccountId?: string | null; kind?: BroadcastMessageAssetKind; name?: string; payload?: unknown }>();
  if (!body.kind || !ASSET_KINDS.has(body.kind) || !body.name?.trim()) {
    return c.json({ success: false, error: 'kind and name are required' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId ?? null])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const payloadError = validatePayload(body.kind, body.payload);
  if (payloadError) return c.json({ success: false, error: payloadError }, 400);
  const row = await createBroadcastMessageAsset(c.env.DB, {
    lineAccountId: body.lineAccountId,
    kind: body.kind,
    name: body.name.trim(),
    payloadJson: JSON.stringify(body.payload),
  });
  return c.json({ success: true, data: row ? serialize(row) : null }, 201);
});

broadcastMessageAssets.put('/api/broadcast-message-assets/:id', requireRole('owner', 'admin'), requireVisibleAsset, async (c) => {
  const existing = await getBroadcastMessageAsset(c.env.DB, c.req.param('id'));
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ name?: string; payload?: unknown }>();
  if (!body.name?.trim()) return c.json({ success: false, error: 'name is required' }, 400);
  const payloadError = validatePayload(existing.kind, body.payload);
  if (payloadError) return c.json({ success: false, error: payloadError }, 400);
  const row = await updateBroadcastMessageAsset(c.env.DB, existing.id, {
    name: body.name.trim(),
    payloadJson: JSON.stringify(body.payload),
  });
  return c.json({ success: true, data: row ? serialize(row) : null });
});

broadcastMessageAssets.delete('/api/broadcast-message-assets/:id', requireRole('owner', 'admin'), requireVisibleAsset, async (c) => {
  const deleted = await deleteBroadcastMessageAsset(c.env.DB, c.req.param('id'));
  return deleted
    ? c.json({ success: true, data: null })
    : c.json({ success: false, error: 'Not found' }, 404);
});

// LINEが取得する素材は認証外の経路で返す。保存時に検証した拡張子だけを許し、
// R2メタデータを信用せず安全なContent-Typeを固定する。
broadcastMessageAssets.get('/images/broadcast-media/:filename', async (c) => {
  const filename = c.req.param('filename');
  const match = filename.match(/^([0-9a-f-]{36})\.(jpg|png|mp4)$/i);
  if (!match) return c.json({ success: false, error: 'Not found' }, 404);
  const contentType = match[2].toLowerCase() === 'jpg'
    ? 'image/jpeg'
    : match[2].toLowerCase() === 'png'
      ? 'image/png'
      : 'video/mp4';
  const object = await c.env.IMAGES.get(`broadcast-media/${filename}`);
  if (!object) return c.json({ success: false, error: 'Not found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: object.etag,
    },
  });
});

broadcastMessageAssets.post('/api/broadcast-message-assets/upload', requireRole('owner', 'admin'), async (c) => {
  const declaredType = (c.req.header('Content-Type') ?? '').split(';')[0];
  const contentLength = Number(c.req.header('Content-Length'));
  const maxBytes = declaredType === 'video/mp4' ? 200 * 1024 * 1024 : 10 * 1024 * 1024;
  if (!(declaredType in BROADCAST_MEDIA_TYPES)) {
    return c.json({ success: false, error: 'JPEG・PNG・MP4のみアップロードできます' }, 400);
  }
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return c.json({ success: false, error: 'Content-Length is required' }, 411);
  }
  if (contentLength > maxBytes) {
    return c.json({ success: false, error: declaredType === 'video/mp4' ? '動画は200MB以下にしてください' : '画像は10MB以下にしてください' }, 400);
  }
  if (!c.req.raw.body) return c.json({ success: false, error: 'File body is required' }, 400);
  const [inspectionBody, storageBody] = c.req.raw.body.tee();
  const validation = validateBroadcastMediaUpload(
    await readPrefix(inspectionBody, 16),
    declaredType,
    c.req.header('X-Filename'),
  );
  if (!validation.ok) {
    await storageBody.cancel().catch(() => undefined);
    return c.json({ success: false, error: validation.error }, 400);
  }
  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
  const stored = await storeBroadcastMedia({
    bucket: c.env.IMAGES,
    body: storageBody,
    contentLength,
    mimeType: validation.mimeType,
    originalFilename: validation.filename,
    publicBaseUrl: workerUrl,
  });
  return c.json({
    success: true,
    data: stored,
  }, 201);
});

export { broadcastMessageAssets, validatePayload };
