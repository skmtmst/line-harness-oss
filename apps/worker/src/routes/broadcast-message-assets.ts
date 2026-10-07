import { prepareImagemapImages, IMAGEMAP_WIDTHS } from '../services/imagemap-images.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  assetStatusOf,
  countBroadcastMessageAssetsByKind,
  createBroadcastMessageAsset,
  createBroadcastAssetFolder,
  deleteBroadcastMessageAsset,
  draftPayloadOf,
  getBroadcastAssetFolderById,
  getBroadcastMessageAsset,
  hasAssetDraft,
  listBroadcastAssetFolders,
  listBroadcastMessageAssetVersions,
  listBroadcastMessageAssets,
  publishBroadcastMessageAsset,
  saveBroadcastMessageAssetDraft,
  type BroadcastMessageAsset,
  type BroadcastMessageAssetKind,
  type BroadcastMessageAssetStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { validateAssetPayload } from '@line-crm/shared';
import { requireRole } from '../middleware/role-guard.js';
import { storeBroadcastMedia } from '../services/broadcast-media-storage.js';
import { builtinFileScan, checkKeyGate } from '../services/file-scan.js';
import { ensureFileScanForUpload } from './file-scan.js';
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
    // 旧caller互換：編集中の下書きがあれば下書きを返す。公開版だけが要るときは
    // publishedPayload を読む。保存直後に公開版が書き換わることはない。
    payload: { ...(JSON.parse(draftPayloadOf(row)) as Record<string,unknown>), assetId: row.id },
    publishedPayload: JSON.parse(row.payload_json) as unknown,
    folderId: row.folder_id ?? null,
    status: assetStatusOf(row),
    hasDraft: hasAssetDraft(row),
    publishedVersion: Number(row.published_version ?? 0),
    publishedAt: row.published_at ?? null,
    draftRevision: Number(row.draft_revision ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 素材の置き場は独立表（broadcast_asset_folders）を見る。
 * 既存foldersは触らない。未割当の置き場は見える人にだけ見える。
 */
async function readAssetFolderId(
  db: D1Database,
  body: Record<string, unknown>,
  accountId: string | null,
  canSeeUnassigned: boolean,
): Promise<{ ok: true; folderId?: string | null } | { ok: false; error: string }> {
  if (!('folderId' in body)) return { ok: true };
  const raw = body.folderId;
  if (raw === null || raw === '') return { ok: true, folderId: null };
  const id = String(raw);
  const folder = await getBroadcastAssetFolderById(db, id);
  if (!folder) return { ok: false, error: 'そのフォルダはありません' };
  if (folder.line_account_id !== accountId && (folder.line_account_id !== null || !canSeeUnassigned)) {
    return { ok: false, error: 'そのフォルダはありません' };
  }
  return { ok: true, folderId: id };
}

function validPublishKey(value: string | null | undefined): value is string {
  return Boolean(value && value.length >= 8 && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value));
}

/**
 * 素材の保存時の形の検査。
 *
 * 枚数・必須項目の数え方は画面と Worker で1つ（`@line-crm/shared`）。
 * 2か所に散ると、画面では10枚まで作れるのに API が9枚で止める、
 * という作り終えてから保存できない形になる（監査 R141）。
 */
function validatePayload(kind: BroadcastMessageAssetKind, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload must be an object';
  return validateAssetPayload(kind, payload as Record<string, unknown>);
}

broadcastMessageAssets.get('/api/broadcast-message-assets', async (c) => {
  const kind = c.req.query('kind') as BroadcastMessageAssetKind | undefined;
  if (kind && !ASSET_KINDS.has(kind)) return c.json({ success: false, error: 'Invalid kind' }, 400);
  const lineAccountId = c.req.query('lineAccountId');
  if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const folderParam = c.req.query('folderId');
  const statusParam = c.req.query('status') as BroadcastMessageAssetStatus | undefined;
  if (statusParam && statusParam !== 'draft' && statusParam !== 'published' && statusParam !== 'published_with_draft') {
    return c.json({ success: false, error: 'Invalid status' }, 400);
  }
  const folderFilter = folderParam === undefined
    ? undefined
    : folderParam === '' || folderParam === '__none__'
      ? null
      : folderParam;
  let rows = await listBroadcastMessageAssets(
    c.env.DB,
    lineAccountId || undefined,
    kind,
    folderParam !== undefined || statusParam !== undefined
      ? { folderId: folderFilter, status: statusParam }
      : undefined,
  );
  const { scope } = await adminAccountScope(c);
  rows = rows.filter((row) => row.line_account_id === null
    ? scope.canSeeUnassigned
    : scope.allowedAccountIds.includes(row.line_account_id));
  return c.json({ success: true, data: rows.map(serialize) });
});

/*
 * PERF-04: 種類ごとの件数だけを返す口。
 * 一覧の初期表示は「種類の札の件数」だけで足りるのに、これまでは
 * 各行の payload まで取って件数を数えていた。中身は種類を開いたとき
 * 従来どおり /api/broadcast-message-assets?kind=… で取る。
 * 数える範囲は一覧と同じ（アカウント可視範囲＋任意の lineAccountId 絞り込み）。
 */
broadcastMessageAssets.get('/api/broadcast-message-assets/counts', async (c) => {
  const lineAccountId = c.req.query('lineAccountId');
  if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const folderParam = c.req.query('folderId');
  const statusParam = c.req.query('status') as BroadcastMessageAssetStatus | undefined;
  if (statusParam && statusParam !== 'draft' && statusParam !== 'published' && statusParam !== 'published_with_draft') {
    return c.json({ success: false, error: 'Invalid status' }, 400);
  }
  const folderFilter = folderParam === undefined
    ? undefined
    : folderParam === '' || folderParam === '__none__'
      ? null
      : folderParam;
  const { scope, where } = await adminAccountScope(c);
  const counts = await countBroadcastMessageAssetsByKind(
    c.env.DB,
    where,
    scope.allowedAccountIds,
    lineAccountId || undefined,
    folderParam !== undefined || statusParam !== undefined
      ? { folderId: folderFilter, status: statusParam }
      : undefined,
  );
  return c.json({ success: true, data: counts });
});

broadcastMessageAssets.get('/api/broadcast-message-assets/folders', async (c) => {
  const lineAccountId = c.req.query('lineAccountId');
  if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  let folders = await listBroadcastAssetFolders(c.env.DB, lineAccountId || undefined);
  const { scope } = await adminAccountScope(c);
  folders = folders.filter((folder) => folder.line_account_id === null
    ? scope.canSeeUnassigned
    : scope.allowedAccountIds.includes(folder.line_account_id));
  return c.json({
    success: true,
    data: folders.map((folder) => ({
      id: folder.id,
      lineAccountId: folder.line_account_id,
      name: folder.name,
      createdAt: folder.created_at,
      updatedAt: folder.updated_at,
    })),
  });
});

broadcastMessageAssets.post('/api/broadcast-message-assets/folders', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ lineAccountId?: string | null; name?: string }>();
  if (!body.name?.trim()) return c.json({ success: false, error: 'name is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId ?? null])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const folder = await createBroadcastAssetFolder(c.env.DB, {
    lineAccountId: body.lineAccountId,
    name: body.name.trim(),
  });
  return c.json({
    success: true,
    data: folder ? {
      id: folder.id,
      lineAccountId: folder.line_account_id,
      name: folder.name,
      createdAt: folder.created_at,
      updatedAt: folder.updated_at,
    } : null,
  }, 201);
});

broadcastMessageAssets.post('/api/broadcast-message-assets', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ lineAccountId?: string | null; kind?: BroadcastMessageAssetKind; name?: string; payload?: unknown; folderId?: string | null }>();
  if (!body.kind || !ASSET_KINDS.has(body.kind) || !body.name?.trim()) {
    return c.json({ success: false, error: 'kind and name are required' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId ?? null])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const payloadError = validatePayload(body.kind, body.payload);
  if (payloadError) return c.json({ success: false, error: payloadError }, 400);
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const folder = await readAssetFolderId(c.env.DB, body as unknown as Record<string, unknown>, body.lineAccountId ?? null, scope.canSeeUnassigned);
  if (!folder.ok) return c.json({ success: false, error: folder.error }, 422);
  if (body.kind === 'rich_message') {
    try { body.payload = await prepareImagemapImages(c.env, body.payload as Record<string,unknown>, body.lineAccountId ?? null, c.env.WORKER_URL || new URL(c.req.url).origin); }
    catch (error) { return c.json({success:false,error:error instanceof Error ? error.message : '画像を準備できませんでした'},422); }
  }
  const row = await createBroadcastMessageAsset(c.env.DB, {
    lineAccountId: body.lineAccountId,
    kind: body.kind,
    name: body.name.trim(),
    payloadJson: JSON.stringify(body.payload),
    folderId: folder.folderId ?? null,
  });
  return c.json({ success: true, data: row ? serialize(row) : null }, 201);
});

broadcastMessageAssets.put('/api/broadcast-message-assets/:id', requireRole('owner', 'admin'), requireVisibleAsset, async (c) => {
  const existing = await getBroadcastMessageAsset(c.env.DB, c.req.param('id'));
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ name?: string; payload?: unknown; folderId?: string | null; expectedVersion?: unknown; expectedDraftRevision?: unknown }>();
  if (!body.name?.trim()) return c.json({ success: false, error: 'name is required' }, 400);
  const payloadError = validatePayload(existing.kind, body.payload);
  if (payloadError) return c.json({ success: false, error: payloadError }, 400);
  // 呼び出し側の期待版。指定があれば古い期待を409で拒否する。
  // 指定がなければ読直し時点の版でCASする（テンプレートPUTと同契約）。
  let expectedVersion: number | undefined;
  let expectedDraftRevision: number | undefined;
  if (body.expectedVersion !== undefined && body.expectedVersion !== null) {
    expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion)) {
      return c.json({ success: false, error: '版の番号を確認してください' }, 400);
    }
  }
  if (body.expectedDraftRevision !== undefined && body.expectedDraftRevision !== null) {
    expectedDraftRevision = Number(body.expectedDraftRevision);
    if (!Number.isInteger(expectedDraftRevision)) {
      return c.json({ success: false, error: '下書きの版を確認してください' }, 400);
    }
  }
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const folder = await readAssetFolderId(c.env.DB, body as unknown as Record<string, unknown>, existing.line_account_id, scope.canSeeUnassigned);
    if (!folder.ok) return c.json({ success: false, error: folder.error }, 422);
    if (existing.kind === 'rich_message') {
      try { body.payload = await prepareImagemapImages(c.env, body.payload as Record<string,unknown>, existing.line_account_id, c.env.WORKER_URL || new URL(c.req.url).origin); }
      catch (error) { return c.json({success:false,error:error instanceof Error ? error.message : '画像を準備できませんでした'},422); }
    }
    // 名前・置き場・下書き本文を1文で書く。CAS敗北時は全面不変。
    const row = await saveBroadcastMessageAssetDraft(c.env.DB, existing.id, {
      name: body.name.trim(),
      folderId: folder.folderId,
      payloadJson: JSON.stringify(body.payload),
      expectedVersion,
      expectedDraftRevision,
    });
    return c.json({ success: true, data: row ? serialize(row) : null });
  } catch (err) {
    if (err instanceof Error && err.message === 'ASSET_VERSION_CONFLICT') {
      return c.json({ success: false, error: 'ほかの人が先に公開しました。開き直して確認してください' }, 409);
    }
    if (err instanceof Error && err.message === 'ASSET_DRAFT_CONFLICT') {
      return c.json({ success: false, error: '編集中に公開状態が変わりました。読み直してください' }, 409);
    }
    throw err;
  }
});

broadcastMessageAssets.post('/api/broadcast-message-assets/:id/publish', requireRole('owner', 'admin'), requireVisibleAsset, async (c) => {
  try {
    const id = c.req.param('id');
    const requestKey = c.req.header('Idempotency-Key');
    if (!validPublishKey(requestKey)) {
      return c.json({ success: false, error: '公開操作の確認キーが必要です' }, 400);
    }
    const existing = await getBroadcastMessageAsset(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body: { expectedVersion?: unknown; expectedDraftRevision?: unknown } =
      await c.req.json().catch(() => ({}));
    const expectedVersion = body.expectedVersion === undefined || body.expectedVersion === null
      ? undefined
      : Number(body.expectedVersion);
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion)) {
      return c.json({ success: false, error: '版の番号を確認してください' }, 400);
    }
    const expectedDraftRevision = body.expectedDraftRevision === undefined || body.expectedDraftRevision === null
      ? undefined
      : Number(body.expectedDraftRevision);
    if (expectedDraftRevision === undefined || !Number.isInteger(expectedDraftRevision)) {
      return c.json({ success: false, error: '下書きの版を確認してください' }, 400);
    }
    const draftPayload = existing.draft_payload_json ?? existing.payload_json;
    const payloadError = validatePayload(existing.kind, JSON.parse(draftPayload) as unknown);
    if (payloadError) return c.json({ success: false, error: payloadError }, 422);
    const staff = c.get('staff') as unknown as { id?: string };
    const result = await publishBroadcastMessageAsset(c.env.DB, id, {
      expectedVersion,
      expectedDraftRevision,
      idempotencyKey: requestKey,
      createdByStaffId: staff?.id ?? null,
    });
    const row = result.row;
    // 同キー再送は当時の記録を返す。後の版が進んでも旧版・旧本文。
    const recorded = result.recordedVersion !== undefined
      ? {
        publishedVersion: result.recordedVersion,
        payload: JSON.parse(result.recordedPayloadJson ?? row.payload_json) as unknown,
        publishedAt: result.recordedPublishedAt ?? row.published_at,
      }
      : null;
    return c.json({
      success: true,
      data: {
        id: row.id,
        kind: row.kind,
        name: row.name,
        payload: recorded?.payload ?? (JSON.parse(draftPayloadOf(row)) as unknown),
        publishedPayload: recorded?.payload ?? (JSON.parse(row.payload_json) as unknown),
        folderId: row.folder_id ?? null,
        status: recorded ? 'published' : assetStatusOf(row),
        publishedVersion: recorded?.publishedVersion ?? Number(row.published_version),
        publishedAt: recorded?.publishedAt ?? row.published_at,
        published: result.published,
        replayed: result.replayed,
        hasDraft: recorded ? false : hasAssetDraft(row),
        draftRevision: recorded ? 0 : Number(row.draft_revision ?? 0),
      },
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'ASSET_VERSION_CONFLICT') {
      return c.json({ success: false, error: 'ほかの人が先に公開しました。開き直して確認してください' }, 409);
    }
    if (code === 'ASSET_DRAFT_CONFLICT') {
      return c.json({ success: false, error: '下書きが書き換わっています。開き直して確認してください' }, 409);
    }
    if (code === 'ASSET_PUBLISH_KEY_CONFLICT') {
      return c.json({ success: false, error: '同じ確認キーが別の公開操作で使われています' }, 409);
    }
    throw err;
  }
});

broadcastMessageAssets.get('/api/broadcast-message-assets/:id/versions', async (c) => {
  const id = c.req.param('id');
  const item = await getBroadcastMessageAsset(c.env.DB, id);
  if (!item || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [item.line_account_id])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const versions = await listBroadcastMessageAssetVersions(c.env.DB, id);
  return c.json({
    success: true,
    data: versions.map((v) => ({
      versionNumber: v.version_number,
      payload: JSON.parse(v.payload_json) as unknown,
      createdAt: v.created_at,
    })),
  });
});

broadcastMessageAssets.delete('/api/broadcast-message-assets/:id', requireRole('owner', 'admin'), requireVisibleAsset, async (c) => {
  const deleted = await deleteBroadcastMessageAsset(c.env.DB, c.req.param('id'));
  return deleted
    ? c.json({ success: true, data: null })
    : c.json({ success: false, error: 'Not found' }, 404);
});

// LINE公式の baseUrl/{幅}。拡張子は付けない。
broadcastMessageAssets.get('/images/imagemaps/:id/:width', async c => {
  const id = c.req.param('id');
  const width = Number(c.req.param('width'));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !IMAGEMAP_WIDTHS.some(value => value === width)) return c.notFound();
  const object = await c.env.IMAGES.get(`imagemaps/${id}/${width}`);
  if (!object) return c.notFound();
  return new Response(object.body,{headers:{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=31536000, immutable'}});
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
  // 検査が終わるまで配信には出さない。記録が無い古いファイルは通す。
  const broadcastGate = await checkKeyGate(c.env.DB, c.env.IMAGES, 'broadcast_asset', `broadcast-media/${filename}`);
  if (!broadcastGate.allowed) {
    return c.json({ success: false, code: broadcastGate.code, error: broadcastGate.message }, 409);
  }
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
  const prefix = await readPrefix(inspectionBody, 16);
  const validation = validateBroadcastMediaUpload(
    prefix,
    declaredType,
    c.req.header('X-Filename'),
  );
  if (!validation.ok) {
    await storageBody.cancel().catch(() => undefined);
    return c.json({ success: false, error: validation.error }, 400);
  }
  // 先頭だけでも分かる脅威（実行ファイルの印）は保存の前に落とす。
  const prefixCheck = builtinFileScan(prefix, {
    filename: validation.filename,
    mimeType: validation.mimeType,
    sizeBytes: contentLength,
    width: 1,
    height: 1,
  });
  if (prefixCheck.verdict === 'quarantined'
    && (prefixCheck.reasonCode === 'executable_signature' || prefixCheck.reasonCode === 'office_macro')) {
    await storageBody.cancel().catch(() => undefined);
    return c.json({ success: false, code: 'file_scan_blocked', error: '確認のため受け付けできません' }, 422);
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
  // 全体の検査は保存の直後に回す。clean になるまで配信には出さない。
  await ensureFileScanForUpload({
    db: c.env.DB,
    lineAccountId: null,
    subjectKind: 'broadcast_asset',
    subjectId: stored.key,
    mediaId: null,
    filename: validation.filename,
    mimeType: validation.mimeType,
    sizeBytes: stored.size,
  }).catch((err) => console.error('broadcast asset scan record error:', stored.key, err));
  return c.json({
    success: true,
    data: stored,
  }, 201);
});

export { broadcastMessageAssets, validatePayload };
