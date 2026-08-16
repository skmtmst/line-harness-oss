import { Hono } from 'hono';
import {
  getSupportMarks,
  getSupportMarkById,
  createSupportMark,
  updateSupportMark,
  deleteSupportMark,
  countFriendsWithMark,
  setFriendSupportMark,
  setFriendSupportMarkBulk,
  getSavedSearches,
  getSavedSearchById,
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  countSavedSearches,
  validateSearchConditions,
  SAVED_SEARCH_LIMIT,
  SAVED_SEARCH_SCOPES,
  getLoginAudit,
  LOGIN_AUDIT_ACTIONS,
  type LoginAuditRow,
  type LoginAuditAction,
  getFolders,
  getFolderById,
  createFolder,
  updateFolder,
  deleteFolder,
  isFolderKind,
  type SupportMark,
  type SavedSearch,
  type Folder,
  type SavedSearchScope,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

/**
 * 対応マーク・保存した検索・汎用フォルダ。
 *
 * 3つとも「友だち属性」の画面の中のタブなので、1つのルータにまとめている。
 * どれも小さく、別ファイルに散らすと登録漏れの方が起きやすい。
 */
const friendAttributes = new Hono<Env>();

function serializeMark(row: SupportMark) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: Boolean(row.is_default),
    autoOnInbound: Boolean(row.auto_on_inbound),
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

function serializeSearch(row: SavedSearch) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    conditions: JSON.parse(row.conditions_json) as unknown,
    createdBy: row.created_by,
    isShared: Boolean(row.is_shared),
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

function serializeFolder(row: Folder) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    parentId: row.parent_id,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 色は #RRGGBB だけ許す。名前付きの色を混ぜると、画面での見た目が揃わない。 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * IPの末尾を伏せる。
 *
 * 監査で見たいのは「いつもと違うところから入っていないか」で、
 * 完全な値は要らない。画面に出す以上、出す量は少ない方がよい。
 */
function maskIp(ip: string): string {
  if (ip.includes(':')) {
    // IPv6。前半だけ残す。
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + ':***';
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return '***';
  return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
}

// ── 対応マーク ──────────────────────────────────────────────

friendAttributes.get('/api/support-marks', async (c) => {
  try {
    const marks = await getSupportMarks(c.env.DB);
    // 何人に付いているかも返す。運用でどれが使われているか分かる。
    const withCounts = [];
    for (const mark of marks) {
      withCounts.push({
        ...serializeMark(mark),
        friendCount: await countFriendsWithMark(c.env.DB, mark.id),
      });
    }
    return c.json({ success: true, data: withCounts });
  } catch (err) {
    console.error('GET /api/support-marks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.post('/api/support-marks', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'マークの名前を入力してください' }, 400);
    if (body.color !== undefined && !COLOR_PATTERN.test(String(body.color))) {
      return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
    }
    const mark = await createSupportMark(c.env.DB, {
      name,
      color: body.color ? String(body.color) : undefined,
      isDefault: body.isDefault === true,
      autoOnInbound: body.autoOnInbound === true,
      displayOrder: Number(body.displayOrder ?? 0),
    });
    return c.json({ success: true, data: serializeMark(mark) }, 201);
  } catch (err) {
    console.error('POST /api/support-marks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.patch('/api/support-marks/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getSupportMarkById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    if (body.color !== undefined && !COLOR_PATTERN.test(String(body.color))) {
      return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
    }
    // 既定を外す操作は止める。既定が1つも無いと、新しい友だちに何も付かない。
    // 別のマークを既定にすれば、こちらは自動で外れる。
    if (body.isDefault === false && existing.is_default === 1) {
      return c.json(
        {
          success: false,
          error:
            '既定のマークを外すことはできません。別のマークを既定にすると、こちらは自動で外れます。',
        },
        409,
      );
    }
    const mark = await updateSupportMark(c.env.DB, id, {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      color: body.color === undefined ? undefined : String(body.color),
      isDefault: body.isDefault === undefined ? undefined : body.isDefault === true,
      autoOnInbound: body.autoOnInbound === undefined ? undefined : body.autoOnInbound === true,
      displayOrder: body.displayOrder === undefined ? undefined : Number(body.displayOrder),
    });
    return c.json({ success: true, data: serializeMark(mark!) });
  } catch (err) {
    console.error('PATCH /api/support-marks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.delete('/api/support-marks/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getSupportMarkById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.is_default === 1) {
      return c.json(
        {
          success: false,
          error: '既定のマークは削除できません。先に別のマークを既定にしてください。',
        },
        409,
      );
    }
    // 付いている友だちは消えない（ON DELETE SET NULL）。何人が未設定に戻るかを伝える。
    const count = await countFriendsWithMark(c.env.DB, id);
    if (count > 0 && c.req.query('force') !== '1') {
      return c.json(
        {
          success: false,
          error: `このマークは ${count} 人に付いています。削除するとその人たちは未設定に戻ります。`,
          code: 'IN_USE',
          friendCount: count,
        },
        409,
      );
    }
    await deleteSupportMark(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/support-marks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.patch(
  '/api/friends/:id/support-mark',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const body = await c.req.json<{ markId?: unknown }>();
      const markId =
        body.markId === null || body.markId === '' || body.markId === undefined
          ? null
          : String(body.markId);
      if (markId) {
        const mark = await getSupportMarkById(c.env.DB, markId);
        if (!mark) return c.json({ success: false, error: 'マークが見つかりません' }, 400);
      }
      await setFriendSupportMark(c.env.DB, c.req.param('id'), markId);
      return c.json({ success: true, data: null });
    } catch (err) {
      console.error('PATCH /api/friends/:id/support-mark error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

friendAttributes.post(
  '/api/friends/support-mark/bulk',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const body = await c.req.json<{ friendIds?: unknown; markId?: unknown }>();
      const friendIds = Array.isArray(body.friendIds) ? body.friendIds.map(String) : [];
      if (friendIds.length === 0) {
        return c.json({ success: false, error: '対象の友だちが選ばれていません' }, 400);
      }
      if (friendIds.length > 1000) {
        return c.json({ success: false, error: '一度に変更できるのは1000人までです' }, 422);
      }
      const markId =
        body.markId === null || body.markId === '' || body.markId === undefined
          ? null
          : String(body.markId);
      const updated = await setFriendSupportMarkBulk(c.env.DB, friendIds, markId);
      return c.json({ success: true, data: { updated } });
    } catch (err) {
      console.error('POST /api/friends/support-mark/bulk error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// ── 保存した検索 ────────────────────────────────────────────

friendAttributes.get('/api/saved-searches', async (c) => {
  try {
    const raw = c.req.query('scope');
    const scope = (SAVED_SEARCH_SCOPES as readonly string[]).includes(raw ?? '')
      ? (raw as SavedSearchScope)
      : undefined;
    const items = await getSavedSearches(c.env.DB, scope);
    return c.json({ success: true, data: items.map(serializeSearch) });
  } catch (err) {
    console.error('GET /api/saved-searches error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.post('/api/saved-searches', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff');
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);

    // 上限を先に見る。条件の検証を通してから弾くと、書いた条件が無駄になる。
    const count = await countSavedSearches(c.env.DB);
    if (count >= SAVED_SEARCH_LIMIT) {
      return c.json(
        {
          success: false,
          error: `保存できる検索は ${SAVED_SEARCH_LIMIT} 件までです。使っていないものを削除してください。`,
        },
        422,
      );
    }

    const conditions = validateSearchConditions(body.conditions);
    if (!conditions.ok) return c.json({ success: false, error: conditions.error }, 422);

    const scope = (SAVED_SEARCH_SCOPES as readonly string[]).includes(String(body.scope))
      ? (String(body.scope) as SavedSearchScope)
      : 'friends';

    const saved = await createSavedSearch(c.env.DB, {
      name,
      scope,
      conditions: conditions.value,
      createdBy: staff?.id ?? null,
      isShared: body.isShared !== false,
      displayOrder: Number(body.displayOrder ?? 0),
    });
    return c.json({ success: true, data: serializeSearch(saved) }, 201);
  } catch (err) {
    console.error('POST /api/saved-searches error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.patch(
  '/api/saved-searches/:id',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const id = c.req.param('id');
      const existing = await getSavedSearchById(c.env.DB, id);
      if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

      const body = await c.req.json<Record<string, unknown>>();
      const patch: Parameters<typeof updateSavedSearch>[2] = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);
        patch.name = name;
      }
      if (body.conditions !== undefined) {
        const conditions = validateSearchConditions(body.conditions);
        if (!conditions.ok) return c.json({ success: false, error: conditions.error }, 422);
        patch.conditions = conditions.value;
      }
      if (body.isShared !== undefined) patch.isShared = body.isShared === true;
      if (body.displayOrder !== undefined) patch.displayOrder = Number(body.displayOrder);

      const saved = await updateSavedSearch(c.env.DB, id, patch);
      return c.json({ success: true, data: serializeSearch(saved!) });
    } catch (err) {
      console.error('PATCH /api/saved-searches/:id error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

friendAttributes.delete(
  '/api/saved-searches/:id',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      await deleteSavedSearch(c.env.DB, c.req.param('id'));
      return c.json({ success: true, data: null });
    } catch (err) {
      console.error('DELETE /api/saved-searches/:id error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// ── ログイン履歴 ────────────────────────────────────────────
//
// 誰がいつ入ったか、誰が個人情報を開いたか。個人情報保護法上の利用記録
// として残す必要がある。
//
// オーナーと管理者だけが見られる。誰がいつ入ったかは、それ自体が
// 見せてよい情報とは限らない。
friendAttributes.get('/api/login-audit', requireRole('owner', 'admin'), async (c) => {
  try {
    const rawAction = c.req.query('action');
    const action = (LOGIN_AUDIT_ACTIONS as readonly string[]).includes(rawAction ?? '')
      ? (rawAction as LoginAuditAction)
      : undefined;
    const items = await getLoginAudit(c.env.DB, {
      adminUserId: c.req.query('userId') || undefined,
      action,
      limit: Number(c.req.query('limit') ?? 100),
    });
    return c.json({
      success: true,
      data: items.map((row: LoginAuditRow) => ({
        id: row.id,
        adminUserId: row.admin_user_id,
        action: row.action,
        screen: row.screen,
        // IPは残すが、一覧では末尾を伏せる。監査に必要なのは
        // 「いつもと違うところから入っていないか」で、完全な値は要らない。
        ip: row.ip ? maskIp(row.ip) : null,
        result: row.result,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/login-audit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 汎用フォルダ ────────────────────────────────────────────

friendAttributes.get('/api/folders', async (c) => {
  try {
    const raw = c.req.query('kind');
    if (raw && !isFolderKind(raw)) {
      return c.json({ success: false, error: '知らないフォルダの種類です' }, 400);
    }
    const items = await getFolders(c.env.DB, raw && isFolderKind(raw) ? raw : undefined);
    return c.json({ success: true, data: items.map(serializeFolder) });
  } catch (err) {
    console.error('GET /api/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.post('/api/folders', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    if (!isFolderKind(body.kind)) {
      return c.json({ success: false, error: '知らないフォルダの種類です' }, 400);
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'フォルダ名を入力してください' }, 400);

    // 入れ子は1段まで。深くすると画面が組み立てられなくなる。
    if (body.parentId) {
      const parent = await getFolderById(c.env.DB, String(body.parentId));
      if (!parent) return c.json({ success: false, error: '親フォルダが見つかりません' }, 400);
      if (parent.parent_id) {
        return c.json({ success: false, error: 'フォルダは2段までです' }, 422);
      }
      if (parent.kind !== body.kind) {
        return c.json({ success: false, error: '別の種類のフォルダには入れられません' }, 422);
      }
    }

    const folder = await createFolder(c.env.DB, {
      kind: body.kind,
      name,
      parentId: body.parentId ? String(body.parentId) : null,
      displayOrder: Number(body.displayOrder ?? 0),
    });
    return c.json({ success: true, data: serializeFolder(folder) }, 201);
  } catch (err) {
    console.error('POST /api/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.patch('/api/folders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getFolderById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const patch: Parameters<typeof updateFolder>[2] = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return c.json({ success: false, error: 'フォルダ名を入力してください' }, 400);
      patch.name = name;
    }
    if ('parentId' in body) {
      const parentId = body.parentId ? String(body.parentId) : null;
      // 自分を自分の親にはできない。一覧の描画が無限に回る。
      if (parentId === id) {
        return c.json({ success: false, error: '自分自身を親にはできません' }, 422);
      }
      patch.parentId = parentId;
    }
    if (body.displayOrder !== undefined) patch.displayOrder = Number(body.displayOrder);

    const folder = await updateFolder(c.env.DB, id, patch);
    return c.json({ success: true, data: serializeFolder(folder!) });
  } catch (err) {
    console.error('PATCH /api/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 中身は消えず「未分類」に戻る。ただし子フォルダは一緒に消える。
friendAttributes.delete('/api/folders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteFolder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendAttributes };
