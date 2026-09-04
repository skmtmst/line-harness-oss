import { Hono, type Context } from 'hono';
import {
  getMedia,
  getMediaById,
  createMedia,
  updateMedia,
  deleteMedia,
  getMediaUsages,
  getMediaDeleteImpact,
  getMediaReplacementPlan,
  applyMediaReplacementPlan,
  jstNow,
  getCommonVars,
  getCommonVarUsageCounts,
  getCommonVarById,
  createCommonVar,
  updateCommonVar,
  deleteCommonVar,
  getCommonVarUsageImpact,
  getCommonVarSchedules,
  createCommonVarSchedule,
  deleteCommonVarSchedule,
  validateFieldKey,
  COMMON_VAR_TYPES,
  type Media,
  type MediaKind,
  type CommonVar,
  type CommonVarSchedule,
  type CommonVarType,
  type CommonVarUsageImpact,
  type CommonVarUsageItem,
} from '@line-crm/db';
import type { CommonVarDeleteImpact, CommonVarUsageKind } from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { scanSingleMediaUsage } from '../services/media-usage-scan.js';
import type { MediaReplacementImpact } from '@line-crm/shared';

/**
 * メディアライブラリと共通情報。
 *
 * どちらも「1か所に置いて使い回す」ための機能で、画面も同じ /contents の
 * タブなので1つのルータにまとめている。
 */
const contents = new Hono<Env>();
const REPLACEMENT_BODY_MAX_BYTES = 16 * 1024;

class RequestBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) {
    super(message);
  }
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declared) && declared > REPLACEMENT_BODY_MAX_BYTES) {
    throw new RequestBodyError(413, '送信内容が大きすぎます');
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REPLACEMENT_BODY_MAX_BYTES) {
      await reader.cancel();
      throw new RequestBodyError(413, '送信内容が大きすぎます');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new RequestBodyError(400, '送信内容を読み取れませんでした');
  }
}

async function replacementRevision(
  sourceId: string,
  replacementId: string,
  usages: Array<{ ref_kind: string; ref_id: string; scanned_at: string }>,
): Promise<string> {
  const raw = [sourceId, replacementId, ...usages.map((usage) =>
    `${usage.ref_kind}:${usage.ref_id}`).sort()].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function replacementImpact(
  c: Context<Env>,
  sourceId: string,
  replacementId: string,
  accountId: string,
): Promise<{
  plan: NonNullable<Awaited<ReturnType<typeof getMediaReplacementPlan>>>;
  impact: MediaReplacementImpact;
} | null> {
  const checkedAt = jstNow();
  const source = await getMediaById(c.env.DB, sourceId, accountId);
  const replacement = await getMediaById(c.env.DB, replacementId, accountId);
  if (!source || !replacement) return null;
  await scanSingleMediaUsage(c.env.DB, checkedAt, { id: source.id, r2_key: source.r2_key });
  const plan = await getMediaReplacementPlan(c.env.DB, {
    sourceId, replacementId, lineAccountId: accountId, checkedAt,
  });
  if (!plan) return null;
  return {
    plan,
    impact: { ...plan.impact, revision: await replacementRevision(sourceId, replacementId, plan.usages) },
  };
}

// ── メディア ────────────────────────────────────────────────

/**
 * 受け付ける形式。MIMEと拡張子の両方を見る。
 *
 * MIMEだけだと、送る側が名乗った値をそのまま信じることになる。
 * 拡張子だけだと、中身が違うものを .png と名付けるだけで通る。
 * 両方が揃っているものだけ通す。
 */
const ALLOWED: Record<string, { kind: MediaKind; ext: string[]; maxBytes: number }> = {
  'image/png': { kind: 'image', ext: ['png'], maxBytes: 10 * 1024 * 1024 },
  'image/jpeg': { kind: 'image', ext: ['jpg', 'jpeg'], maxBytes: 10 * 1024 * 1024 },
  'image/gif': { kind: 'image', ext: ['gif'], maxBytes: 10 * 1024 * 1024 },
  'image/webp': { kind: 'image', ext: ['webp'], maxBytes: 10 * 1024 * 1024 },
  'video/mp4': { kind: 'video', ext: ['mp4'], maxBytes: 90 * 1024 * 1024 },
  'audio/mpeg': { kind: 'audio', ext: ['mp3'], maxBytes: 30 * 1024 * 1024 },
  'audio/mp4': { kind: 'audio', ext: ['m4a'], maxBytes: 30 * 1024 * 1024 },
  'application/pdf': { kind: 'file', ext: ['pdf'], maxBytes: 20 * 1024 * 1024 },
};

/**
 * 動画の上限を 90MB にしている理由。
 *
 * 要件定義書は 200MB としているが、Cloudflare Workers が1リクエストで
 * 受け取れる本文には上限があり（プランによって 100MB 前後）、
 * 200MB は届く前に切られる。「アップロードできます」と書いておいて
 * 大きいファイルだけ黙って失敗する方が困るので、確実に通る値にした。
 *
 * それ以上を扱うなら、R2 へ直接上げる仕組み（署名付きURL）が要る。
 */

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** ブラウザの申告ではなく、実際の先頭バイトが選んだ形式と一致するかを見る。 */
function hasMediaSignature(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  switch (mimeType) {
    case 'image/png':
      return bytes.length >= 8
        && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
          .every((value, index) => bytes[index] === value);
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'video/mp4':
    case 'audio/mp4':
      return bytes.length >= 12 && ascii(4, 4) === 'ftyp';
    case 'audio/mpeg':
      return ascii(0, 3) === 'ID3'
        || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-';
    default:
      return false;
  }
}

function serializeMedia(row: Media, workerUrl: string) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    folderId: row.folder_id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    url: row.public_url ?? `${workerUrl}/images/${row.r2_key}`,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    usageCount: row.usage_count === undefined ? undefined : Number(row.usage_count),
  };
}

contents.get('/api/media', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const kindRaw = c.req.query('kind');
    const kind = kindRaw && ['image', 'video', 'audio', 'file'].includes(kindRaw)
      ? (kindRaw as MediaKind)
      : undefined;
    const items = await getMedia(c.env.DB, {
      lineAccountId: accountId,
      kind,
      folderId: c.req.query('folderId') || undefined,
    });
    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({ success: true, data: items.map((m) => serializeMedia(m, workerUrl)) });
  } catch (err) {
    console.error('GET /api/media error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.post('/api/media', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff');
    const body = await c.req.json<{
      accountId?: string;
      data?: string;
      filename?: string;
      mimeType?: string;
      folderId?: string | null;
      width?: number;
      height?: number;
      durationMs?: number;
    }>();

    const accountId = body.accountId?.trim() ?? '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    const filename = (body.filename ?? '').trim();
    if (!filename) return c.json({ success: false, error: 'ファイル名がありません' }, 400);
    if (!body.data) return c.json({ success: false, error: 'ファイルの中身がありません' }, 400);

    // data: URL 形式で来た場合は、そこに書かれた種別を優先する。
    let base64 = body.data;
    let mimeType = body.mimeType ?? '';
    const dataUrl = /^data:([^;]+);base64,(.+)$/.exec(base64);
    if (dataUrl) {
      mimeType = dataUrl[1];
      base64 = dataUrl[2];
    }

    const spec = ALLOWED[mimeType];
    if (!spec) {
      return c.json(
        {
          success: false,
          error: `この形式は受け付けていません（${mimeType || '不明'}）。対応: ${Object.keys(ALLOWED).join(', ')}`,
        },
        400,
      );
    }
    const ext = extensionOf(filename);
    if (!spec.ext.includes(ext)) {
      // 中身と名前が食い違っている。どちらかが間違っているので保存しない。
      return c.json(
        {
          success: false,
          error: `ファイル名の拡張子（.${ext || 'なし'}）が中身の形式（${mimeType}）と合いません`,
        },
        400,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    } catch {
      return c.json({ success: false, error: 'ファイルの中身を読み取れませんでした' }, 400);
    }
    if (bytes.byteLength > spec.maxBytes) {
      return c.json(
        {
          success: false,
          error: `ファイルが大きすぎます（上限 ${Math.round(spec.maxBytes / 1024 / 1024)}MB）`,
        },
        413,
      );
    }
    if (!hasMediaSignature(bytes, mimeType)) {
      return c.json(
        { success: false, error: 'ファイルの実際の形式が、選択された形式と一致しません' },
        400,
      );
    }

    const r2Key = `media/${crypto.randomUUID()}.${ext}`;
    await c.env.IMAGES.put(r2Key, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename },
    });

    let media: Media;
    try {
      media = await createMedia(c.env.DB, {
        lineAccountId: accountId,
        kind: spec.kind,
        filename,
        mimeType,
        sizeBytes: bytes.byteLength,
        r2Key,
        folderId: body.folderId ?? null,
        width: body.width ?? null,
        height: body.height ?? null,
        durationMs: body.durationMs ?? null,
        uploadedBy: staff?.id ?? null,
      });
    } catch (error) {
      // DBに行が無い実体は画面から消せない。登録失敗時に同じ場で片付ける。
      await c.env.IMAGES.delete(r2Key).catch((cleanupError) =>
        console.error('media orphan cleanup failed:', cleanupError));
      throw error;
    }
    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({ success: true, data: serializeMedia(media, workerUrl) }, 201);
  } catch (err) {
    console.error('POST /api/media error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.patch('/api/media/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getMediaById(c.env.DB, id, accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ filename?: string; folderId?: string | null }>();
    const media = await updateMedia(c.env.DB, id, accountId, {
      filename: body.filename === undefined ? undefined : String(body.filename).trim(),
      ...(('folderId' in body) ? { folderId: body.folderId ?? null } : {}),
    });
    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({ success: true, data: serializeMedia(media!, workerUrl) });
  } catch (err) {
    console.error('PATCH /api/media/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.get('/api/media/:id/usages', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getMediaById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const usages = await getMediaUsages(c.env.DB, c.req.param('id'));
    return c.json({
      success: true,
      data: usages.map((u) => ({ refKind: u.ref_kind, refId: u.ref_id, scannedAt: u.scanned_at })),
    });
  } catch (err) {
    console.error('GET /api/media/:id/usages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 削除前に、現在記録されている使用先を名前と導線付きで確認する。
contents.get('/api/media/:id/delete-impact', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getMediaById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const checkedAt = jstNow();
    await scanSingleMediaUsage(c.env.DB, checkedAt, {
      id: existing.id,
      r2_key: existing.r2_key,
    });
    const impact = await getMediaDeleteImpact(c.env.DB, c.req.param('id'), accountId, checkedAt);
    if (!impact) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: impact });
  } catch (err) {
    console.error('GET /api/media/:id/delete-impact error:', err);
    return c.json(
      { success: false, error: '削除したときの影響を確認できませんでした' },
      503,
    );
  }
});

// 差し替える前に、現在の使用先を7種類すべて読み直す。内部IDは返さない。
contents.get('/api/media/:id/replacement-impact', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    const replacementId = c.req.query('replacementId')?.trim();
    if (!accountId || !replacementId) {
      return c.json({ success: false, error: 'accountId と replacementId が必要です' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const current = await replacementImpact(c, c.req.param('id'), replacementId, accountId);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: current.impact });
  } catch (err) {
    console.error('GET /api/media/:id/replacement-impact error:', err);
    return c.json({ success: false, error: '差し替えたときの影響を確認できませんでした' }, 503);
  }
});

// 画面で読んだ影響は信用せず、同じ7種類を実行直前にも読み直す。
contents.post('/api/media/:id/replace-usages', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const body = await readBoundedJson(c.req.raw);
    const replacementId = typeof body.replacementMediaId === 'string'
      ? body.replacementMediaId.trim()
      : '';
    const expectedRevision = typeof body.expectedRevision === 'string'
      ? body.expectedRevision.trim()
      : '';
    if (!replacementId || !expectedRevision) {
      return c.json({ success: false, error: '差し替え先と、確認した版が必要です' }, 400);
    }

    const current = await replacementImpact(c, c.req.param('id'), replacementId, accountId);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);
    if (current.impact.revision !== expectedRevision) {
      return c.json({
        success: false,
        code: 'media_replacement_changed',
        error: '使用先が変わりました。最新の影響を読み直してから、もう一度お試しください。',
        data: current.impact,
      }, 409);
    }
    if (!current.impact.canReplace || !current.plan) {
      return c.json({
        success: false,
        code: 'media_replacement_blocked',
        error: '一括で差し替えられない使用先があります。表示された使用先を個別に確認してください。',
        data: current.impact,
      }, 409);
    }

    const replacedUsageCount = await applyMediaReplacementPlan(c.env.DB, current.plan, accountId);
    let remainingUsageCount: number | null = null;
    let verification: 'verified' | 'partial' | 'unavailable' = 'unavailable';
    const verifiedAt = jstNow();
    try {
      await Promise.all([
        scanSingleMediaUsage(c.env.DB, verifiedAt, {
          id: current.plan.source.id,
          r2_key: current.plan.source.r2_key,
        }),
        scanSingleMediaUsage(c.env.DB, verifiedAt, {
          id: current.plan.replacement.id,
          r2_key: current.plan.replacement.r2_key,
        }),
      ]);
      remainingUsageCount = (await getMediaUsages(c.env.DB, current.plan.source.id)).length;
      verification = remainingUsageCount === 0
        && replacedUsageCount === current.impact.replaceableCount
        ? 'verified'
        : 'partial';
    } catch (verifyError) {
      // 差し替え自体はD1のbatchで確定済み。ここで500を返すと、利用者が
      // 再実行して二重操作するため「確認できなかった」と成功レスポンスに残す。
      console.error('media replacement verification failed:', verifyError);
    }
    return c.json({
      success: true,
      data: {
        sourceId: current.plan.source.id,
        replacementId: current.plan.replacement.id,
        replacedUsageCount,
        remainingUsageCount,
        verification,
        checkedAt: verifiedAt,
      },
    });
  } catch (err) {
    if (err instanceof RequestBodyError) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    console.error('POST /api/media/:id/replace-usages error:', err);
    return c.json({ success: false, error: '使用先を差し替えられませんでした' }, 503);
  }
});

// 使われていれば最新の影響を返して止める。画面で前に読んだ結果は信用しない。
contents.delete('/api/media/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getMediaById(c.env.DB, id, accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const checkedAt = jstNow();
    await scanSingleMediaUsage(c.env.DB, checkedAt, {
      id: existing.id,
      r2_key: existing.r2_key,
    });
    const impact = await getMediaDeleteImpact(c.env.DB, id, accountId, checkedAt);
    if (!impact) return c.json({ success: false, error: 'Not found' }, 404);
    if (!impact.canDelete) {
      return c.json(
        {
          success: false,
          error: `このファイルは ${impact.usageCount} か所で使われています。先に使用先から外してください。`,
          code: 'media_delete_blocked',
          data: impact,
        },
        409,
      );
    }

    // R2 の実体を先に消すと、DBの削除に失敗したときに「行はあるが実体が無い」
    // 状態になる。行を消してから実体を消す。逆なら孤児のファイルが残るだけで、
    // 画面には出てこない。
    await deleteMedia(c.env.DB, id, accountId);
    const removal = c.env.IMAGES.delete(existing.r2_key).catch((err) =>
      console.error('R2 delete failed:', err),
    );
    // c.executionCtx は使えない場面で参照そのものが例外を投げるので、
    // 参照ごと守る。使えなければ待つ。実体の削除はどちらでも構わない
    // （行はもう消えているので、画面には出てこない）。
    try {
      c.executionCtx.waitUntil(removal);
    } catch {
      await removal;
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/media/:id error:', err);
    return c.json({ success: false, error: '削除したときの影響を確認できませんでした' }, 503);
  }
});

// ── 共通情報 ────────────────────────────────────────────────

function serializeVar(row: CommonVar) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    folderId: row.folder_id,
    name: row.name,
    varKey: row.var_key,
    type: row.type,
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextSchedule: row.next_effective_from
      ? { effectiveFrom: row.next_effective_from, value: row.next_value ?? '' }
      : null,
    pendingScheduleCount: Number(row.pending_schedule_count ?? 0),
    usageCount: Number(row.usage_count ?? 0),
  };
}

function serializeSchedule(row: CommonVarSchedule) {
  return {
    id: row.id,
    varId: row.var_id,
    effectiveFrom: row.effective_from,
    value: row.value,
    appliedAt: row.applied_at,
  };
}

const COMMON_VAR_USAGE_KIND_LABELS: Record<CommonVarUsageKind, string> = {
  template: 'テンプレート',
  broadcast: '一斉配信',
  scenario: 'シナリオ配信',
  reminder: 'リマインダ',
  auto_reply: '自動応答',
  form: '回答フォーム',
  automation: 'オートメーション',
  friend_add: '友だち追加時の配信',
  common_action: '共通アクション',
};

function collectReadableStrings(value: unknown, token: string, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes(token)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReadableStrings(item, token, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectReadableStrings(item, token, out);
    }
  }
}

/** JSON設定の内部構造を出さず、差し込みを含む人向けの文だけを短く返す。 */
function readableCommonVarUsage(content: string, token: string): string {
  let text = content;
  try {
    const strings: string[] = [];
    collectReadableStrings(JSON.parse(content) as unknown, token, strings);
    // 共通情報を増減する操作は varKey を内部JSONに持つ。人向けの文が
    // 無いときはJSONを見せず、下の共通文へ倒す。
    text = strings.join(' ／ ');
  } catch {
    // 通常の本文はJSONではない。
  }
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'この設定の中で使われています';
  return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

function commonVarUsageHref(item: CommonVarUsageItem): string {
  const id = encodeURIComponent(item.source_parent_id ?? item.source_id);
  switch (item.kind) {
    case 'template': return `/templates/edit?id=${id}`;
    case 'broadcast': return `/broadcasts/detail?id=${id}`;
    case 'scenario': return `/scenarios/detail?id=${id}`;
    case 'reminder': return `/reminders/edit?id=${id}`;
    case 'auto_reply': return `/auto-replies/edit?id=${id}`;
    case 'form': return `/form-submissions/edit?id=${id}`;
    case 'automation': return '/automations';
    case 'friend_add': return '/friend-add-settings';
    case 'common_action': return `/common-actions/versions?id=${id}`;
  }
}

function commonVarUsageStatus(item: CommonVarUsageItem): string {
  if (item.is_historical === 1) return '送信済み・変わりません';
  if (item.source_status === 'scheduled') return '配信予約中';
  if (item.source_status === 'sending') return '配信中';
  if (item.source_status === 'draft') return '下書き';
  if (item.source_status === 'stopped') return '停止中';
  return '使われています';
}

function serializeCommonVarDeleteImpact(
  variable: CommonVar,
  impact: CommonVarUsageImpact,
): CommonVarDeleteImpact {
  const token = `{{var.${variable.var_key}}}`;
  const canDelete = impact.blockingTotal === 0;
  return {
    variable: { id: variable.id, name: variable.name, varKey: variable.var_key },
    total: impact.total,
    blockingTotal: impact.blockingTotal,
    historicalTotal: impact.historicalTotal,
    unscopedFormTotal: impact.unscopedFormTotal,
    canDelete,
    byKind: impact.byKind,
    items: impact.items.map((item) => ({
      kind: item.kind,
      kindLabel: COMMON_VAR_USAGE_KIND_LABELS[item.kind],
      name: item.source_name,
      status: commonVarUsageStatus(item),
      href: commonVarUsageHref(item),
      blocksDeletion: item.is_historical !== 1,
      currentPreview: readableCommonVarUsage(item.source_content, token)
        .replaceAll(token, variable.value),
    })),
    unavailableReferences: impact.unscopedFormTotal > 0
      ? [{
          kind: 'form',
          kindLabel: COMMON_VAR_USAGE_KIND_LABELS.form,
          count: impact.unscopedFormTotal,
          reason: '所属するLINEアカウントを確認できないため、名前と内容は表示しません',
        }]
      : [],
    checkedAt: jstNow(),
    recommendedAction: canDelete ? 'delete' : 'review_references',
  };
}

const LINE_TEXT_USAGE_KINDS = new Set<CommonVarUsageKind>([
  'template', 'broadcast', 'scenario', 'reminder', 'auto_reply', 'form',
]);
const LINE_TEXT_CHARACTER_LIMIT = 5_000;

/** 値を保存する前に、表示文の差分と検査結果だけを安全な形で返す。 */
function serializeCommonVarChangeImpact(
  variable: CommonVar,
  impact: CommonVarUsageImpact,
  nextValue: string,
) {
  const base = serializeCommonVarDeleteImpact(variable, impact);
  const token = `{{var.${variable.var_key}}}`;
  const items = impact.items.map((item, index) => {
    const safeSource = readableCommonVarUsage(item.source_content, token);
    const previewAvailable = safeSource.includes(token);
    const currentPreview = previewAvailable
      ? safeSource.replaceAll(token, variable.value)
      : base.items[index]!.currentPreview;
    const changesOnSave = item.is_historical !== 1;
    const nextPreview = !changesOnSave
      ? currentPreview
      : previewAvailable
        ? safeSource.replaceAll(token, nextValue)
        : null;
    const characterLimit = LINE_TEXT_USAGE_KINDS.has(item.kind)
      ? LINE_TEXT_CHARACTER_LIMIT
      : null;
    const nextCharacterCount = nextPreview === null ? null : [...nextPreview].length;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (changesOnSave && nextValue.length === 0) errors.push('変更後の値が空になります');
    if (characterLimit !== null && nextCharacterCount !== null
      && nextCharacterCount > characterLimit) {
      errors.push(`変更後の文が${characterLimit.toLocaleString('ja-JP')}文字を超えます`);
    }
    if (changesOnSave && !previewAvailable) {
      warnings.push('変更後の文は使用先を開いて確認してください');
    }
    return {
      ...base.items[index],
      changesOnSave,
      previewAvailable,
      currentPreview,
      nextPreview,
      currentCharacterCount: [...currentPreview].length,
      nextCharacterCount,
      characterLimit,
      exceedsCharacterLimit: characterLimit !== null && nextCharacterCount !== null
        ? nextCharacterCount > characterLimit
        : false,
      errors,
      warnings,
    };
  });
  return {
    ...base,
    variable: {
      ...base.variable,
      currentValue: variable.value,
      nextValue,
    },
    items,
    errorTotal: items.reduce((sum, item) => sum + item.errors.length, 0),
    warningTotal: items.reduce((sum, item) => sum + item.warnings.length, 0),
    canSave: items.every((item) => item.errors.length === 0),
    recommendedAction: items.some((item) => item.errors.length > 0)
      ? 'fix_errors'
      : impact.blockingTotal > 0
        ? 'confirm_changes'
        : 'save',
  };
}

contents.get('/api/common-vars', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const items = await getCommonVars(c.env.DB, {
      lineAccountId: accountId,
      folderId: c.req.query('folderId') || undefined,
    });
    const usageCounts = await getCommonVarUsageCounts(
      c.env.DB,
      items.map((item) => item.var_key),
      accountId,
    );
    for (const item of items) item.usage_count = usageCounts.get(item.var_key) ?? 0;
    return c.json({ success: true, data: items.map(serializeVar) });
  } catch (err) {
    console.error('GET /api/common-vars error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.post('/api/common-vars', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);

    // 差し込み名の決まりは友だち情報欄と同じ。片方だけ緩めると、
    // 「情報欄では使えないのに共通情報では使える名前」ができて混乱する。
    const keyCheck = validateFieldKey(body.varKey);
    if (!keyCheck.ok) return c.json({ success: false, error: keyCheck.error }, 422);

    const type = (COMMON_VAR_TYPES as readonly string[]).includes(String(body.type))
      ? (String(body.type) as CommonVarType)
      : 'text';

    const created = await createCommonVar(c.env.DB, {
      lineAccountId: accountId,
      name,
      varKey: String(body.varKey),
      type,
      value: body.value == null ? '' : String(body.value),
      folderId: body.folderId ? String(body.folderId) : null,
    });
    return c.json({ success: true, data: serializeVar(created) }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'その差し込み名は既に使われています' }, 409);
    }
    console.error('POST /api/common-vars error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.patch('/api/common-vars/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, id, accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    // 差し込み名は変えられない。変えるとテンプレートの差し込みが黙って空になる。
    if (body.varKey !== undefined && body.varKey !== existing.var_key) {
      return c.json(
        {
          success: false,
          error:
            '差し込み名は後から変えられません。テンプレートの差し込みが空になるためです。新しく作ってください。',
        },
        422,
      );
    }
    const updated = await updateCommonVar(c.env.DB, id, accountId, {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      value: body.value === undefined ? undefined : String(body.value),
      ...(('folderId' in body) ? { folderId: body.folderId ? String(body.folderId) : null } : {}),
    });
    return c.json({ success: true, data: serializeVar(updated!) });
  } catch (err) {
    console.error('PATCH /api/common-vars/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.get('/api/common-vars/:id/delete-impact', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const impact = await getCommonVarUsageImpact(c.env.DB, existing.var_key, accountId);
    return c.json({ success: true, data: serializeCommonVarDeleteImpact(existing, impact) });
  } catch (err) {
    console.error('GET /api/common-vars/:id/delete-impact error:', err);
    return c.json(
      { success: false, error: '使用先を確認できないため削除できません' },
      503,
    );
  }
});

contents.post('/api/common-vars/:id/impact-preview', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await readBoundedJson(c.req.raw);
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (typeof body.nextValue !== 'string') {
      return c.json({ success: false, error: '変更後の値を入力してください' }, 400);
    }
    const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const impact = await getCommonVarUsageImpact(c.env.DB, existing.var_key, accountId);
    return c.json({
      success: true,
      data: serializeCommonVarChangeImpact(existing, impact, body.nextValue),
    });
  } catch (err) {
    if (err instanceof RequestBodyError) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    console.error('POST /api/common-vars/:id/impact-preview error:', err);
    return c.json(
      { success: false, error: '影響する場所を確認できませんでした' },
      503,
    );
  }
});

contents.delete('/api/common-vars/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const impact = await getCommonVarUsageImpact(c.env.DB, existing.var_key, accountId);
    const deleteImpact = serializeCommonVarDeleteImpact(existing, impact);
    if (!deleteImpact.canDelete) {
      return c.json(
        {
          success: false,
          error: `${impact.blockingTotal}件で使用中のため削除できません`,
          code: 'common_var_delete_blocked',
          data: deleteImpact,
        },
        409,
      );
    }
    await deleteCommonVar(c.env.DB, existing.id, accountId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/common-vars/:id error:', err);
    return c.json(
      { success: false, error: '使用先を確認できないため削除できません' },
      503,
    );
  }
});

contents.get('/api/common-vars/:id/schedules', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const items = await getCommonVarSchedules(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: items.map(serializeSchedule) });
  } catch (err) {
    console.error('GET /api/common-vars/:id/schedules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.post('/api/common-vars/:id/schedules', requireRole('owner', 'admin'), async (c) => {
  try {
    const varId = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, varId, accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<{ effectiveFrom?: unknown; value?: unknown }>();
    const effectiveFrom = String(body.effectiveFrom ?? '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(effectiveFrom)) {
      return c.json(
        { success: false, error: '切り替える日時は 2026-09-01T10:00 の形で指定してください' },
        400,
      );
    }
    // 過ぎた日時は受け付けない。入れた瞬間に次のCronで当たり、
    // 「予約したつもりが今すぐ変わった」になる。
    const jstNowIso = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);
    if (effectiveFrom < jstNowIso) {
      return c.json({ success: false, error: '過去の日時は指定できません' }, 400);
    }

    const created = await createCommonVarSchedule(c.env.DB, {
      varId,
      effectiveFrom,
      value: String(body.value ?? ''),
    });
    return c.json({ success: true, data: serializeSchedule(created) }, 201);
  } catch (err) {
    console.error('POST /api/common-vars/:id/schedules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.delete(
  '/api/common-vars/:id/schedules/:scheduleId',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = c.req.query('accountId')?.trim();
      if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
      if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
      await deleteCommonVarSchedule(c.env.DB, c.req.param('scheduleId'), existing.id);
      return c.json({ success: true, data: null });
    } catch (err) {
      console.error('DELETE /api/common-vars/:id/schedules/:scheduleId error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

export { contents };
