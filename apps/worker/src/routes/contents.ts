import { Hono } from 'hono';
import {
  getMedia,
  getMediaById,
  createMedia,
  updateMedia,
  deleteMedia,
  getMediaUsages,
  countMediaUsages,
  getCommonVars,
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
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

/**
 * メディアライブラリと共通情報。
 *
 * どちらも「1か所に置いて使い回す」ための機能で、画面も同じ /contents の
 * タブなので1つのルータにまとめている。
 */
const contents = new Hono<Env>();

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

function serializeMedia(row: Media, workerUrl: string) {
  return {
    id: row.id,
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
  };
}

contents.get('/api/media', async (c) => {
  try {
    const kindRaw = c.req.query('kind');
    const kind = kindRaw && ['image', 'video', 'audio', 'file'].includes(kindRaw)
      ? (kindRaw as MediaKind)
      : undefined;
    const items = await getMedia(c.env.DB, {
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
      data?: string;
      filename?: string;
      mimeType?: string;
      folderId?: string | null;
      width?: number;
      height?: number;
      durationMs?: number;
    }>();

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

    const r2Key = `media/${crypto.randomUUID()}.${ext}`;
    await c.env.IMAGES.put(r2Key, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename },
    });

    const media = await createMedia(c.env.DB, {
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
    const existing = await getMediaById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ filename?: string; folderId?: string | null }>();
    const media = await updateMedia(c.env.DB, id, {
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

// 使われていれば件数を返して止める。消すと、その箇所の画像が表示されなくなる。
contents.delete('/api/media/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getMediaById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const usage = await countMediaUsages(c.env.DB, id);
    if (usage > 0 && c.req.query('force') !== '1') {
      return c.json(
        {
          success: false,
          error: `このファイルは ${usage} か所で使われています。削除すると、その箇所の表示が崩れます。`,
          code: 'IN_USE',
          usageCount: usage,
        },
        409,
      );
    }

    // R2 の実体を先に消すと、DBの削除に失敗したときに「行はあるが実体が無い」
    // 状態になる。行を消してから実体を消す。逆なら孤児のファイルが残るだけで、
    // 画面には出てこない。
    await deleteMedia(c.env.DB, id);
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
    return c.json({ success: false, error: 'Internal server error' }, 500);
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
    const impact = await getCommonVarUsageImpact(c.env.DB, existing.var_key);
    return c.json({ success: true, data: { ...impact, canDelete: impact.total === 0 } });
  } catch (err) {
    console.error('GET /api/common-vars/:id/delete-impact error:', err);
    return c.json(
      { success: false, error: '使用先を確認できないため削除できません' },
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
    const impact = await getCommonVarUsageImpact(c.env.DB, existing.var_key);
    if (impact.total > 0) {
      return c.json(
        {
          success: false,
          error: `${impact.total}件で使用中のため削除できません`,
          code: 'COMMON_VAR_IN_USE',
          data: { ...impact, canDelete: false },
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
