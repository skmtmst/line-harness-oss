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
  const { scope } = await adminAccountScope(c);
  const rows = (await listBroadcastMessageAssets(c.env.DB, lineAccountId, kind)).filter((row) =>
    row.line_account_id === null
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

broadcastMessageAssets.post('/api/broadcast-message-assets/upload', requireRole('owner', 'admin'), async (c) => {
  const mimeType = (c.req.header('Content-Type') ?? '').split(';')[0];
  const contentLength = Number(c.req.header('Content-Length'));
  const maxBytes = mimeType === 'video/mp4' ? 200 * 1024 * 1024 : 10 * 1024 * 1024;
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(mimeType)) {
    return c.json({ success: false, error: 'JPEG・PNG・MP4のみアップロードできます' }, 400);
  }
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return c.json({ success: false, error: 'Content-Length is required' }, 411);
  }
  if (contentLength > maxBytes) {
    return c.json({ success: false, error: mimeType === 'video/mp4' ? '動画は200MB以下にしてください' : '画像は10MB以下にしてください' }, 400);
  }
  if (!c.req.raw.body) return c.json({ success: false, error: 'File body is required' }, 400);
  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
  const stored = await storeBroadcastMedia({
    bucket: c.env.IMAGES,
    body: c.req.raw.body,
    contentLength,
    mimeType,
    originalFilename: c.req.header('X-Filename'),
    publicBaseUrl: workerUrl,
  });
  return c.json({ success: true, data: stored }, 201);
});

export { broadcastMessageAssets, validatePayload };
