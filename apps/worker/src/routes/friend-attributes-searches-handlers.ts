import { listQueryNumber } from '../lib/list-paging.js';
import { inputError } from '../lib/input-errors.js';

import { getSupportMarkById, setFriendSupportMarkBulk, getSavedSearches, getSavedSearchById, createSavedSearch, reorderSavedSearches, updateSavedSearchWithRevision, deleteSavedSearch, countSavedSearches, getSavedSearchReferences, getSavedSearchUsageCounts, getSavedSearchReferenceUsageCounts, validateSearchConditions, SAVED_SEARCH_LIMIT, getLoginAudit, getStaffMembers, LOGIN_AUDIT_ACTIONS, type LoginAuditRow, type LoginAuditAction, getFolders, getFolderItemCounts, isFolderKind, getWebinarFolderCounts } from '@line-crm/db';

import type { Env } from '../worker-env.js';

import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { getSavedSearchMatchInsights, getSavedSearchMatchPreview, type SavedSearchMatchInsight } from '../services/saved-search-insights.js';
import { supportMarkAccess, requestedConditionFormat, positiveInteger, nonNegativeInteger, savedSearchAccess, savedSearchReferenceMap, serializeSearch, canReadSavedSearch, savedSearchMatchForRow, savedSearchDetail, validateConditionsForFormat, maskIp, serializeFolder } from './friend-attributes-definition.js';
import type { Context } from 'hono';

export const post__api_friends_support_mark_bulk_1 = async (c: Context<Env, "/api/friends/support-mark/bulk">) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const body = await c.req.json<{ friendIds?: unknown; markId?: unknown }>();
      const friendIds = Array.isArray(body.friendIds) ? body.friendIds.map(String) : [];
      if (friendIds.length === 0) {
        return inputError(c, { success: false, error: '対象の友だちが選ばれていません' }, 400, ["friendIds"]);
      }
      if (friendIds.length > 1000) {
        return inputError(c, { success: false, error: '一度に変更できるのは1000人までです' }, 422, ["friendIds"]);
      }
      const markId =
        body.markId === null || body.markId === '' || body.markId === undefined
          ? null
          : String(body.markId);
      if (markId && !(await getSupportMarkById(c.env.DB, markId, scope))) {
        return inputError(c, { success: false, error: 'マークが見つかりません' }, 400, ["markId"]);
      }
      const updated = await setFriendSupportMarkBulk(c.env.DB, friendIds, markId, scope);
      return c.json({ success: true, data: { updated } });
    } catch (err) {
      throw err;
    }
  };

export const get__api_saved_searches_2 = async (c: Context<Env, "/api/saved-searches">) => {
  try {
    const format = requestedConditionFormat(c);
    if (format instanceof Response) return format;
    const owner = c.req.query('owner') ?? 'all';
    const usage = c.req.query('usage') ?? 'all';
    const match = c.req.query('match') ?? 'all';
    if (!['all', 'me'].includes(owner)
      || !['all', 'used', 'unused'].includes(usage)
      || !['all', 'matched', 'zero'].includes(match)) {
      return c.json({ success: false, error: '一覧の絞り込み条件が正しくありません' }, 400);
    }
    const limit = positiveInteger(c.req.query('limit'), 20, 50);
    const offset = nonNegativeInteger(c.req.query('cursor'));
    if (limit === null || offset === null) {
      return c.json({ success: false, error: 'ページ位置が正しくありません' }, 400);
    }
    const access = await savedSearchAccess(c);
    if (access instanceof Response) return access;
    const items = await getSavedSearches(c.env.DB, 'friends', access, format);
    const visible = items.filter((row) =>
      row.scope === 'friends' && (row.condition_format ?? 'search_v1') === format
      && (row.line_account_id === access.lineAccountId
        ? access.canManageAll || Boolean(row.is_shared) || row.created_by === access.staffId
        : row.line_account_id === null && row.created_by === access.staffId));
    const ids = visible.map((row) => row.id);
    const [insights, references, callCounts, referenceCallCounts] = await Promise.all([
      format === 'search_v1'
        ? getSavedSearchMatchInsights(c.env.DB, visible, access.lineAccountId)
        : Promise.resolve(new Map<string, SavedSearchMatchInsight>()),
      getSavedSearchReferences(c.env.DB, ids, access.lineAccountId),
      getSavedSearchUsageCounts(c.env.DB, ids, access.lineAccountId),
      getSavedSearchReferenceUsageCounts(c.env.DB, ids, access.lineAccountId),
    ]);
    const referencesBySearch = savedSearchReferenceMap(references);
    const serialized = visible.map((row) => serializeSearch(
      row,
      insights.get(row.id),
      referencesBySearch.get(row.id),
      callCounts.get(row.id) ?? 0,
      referenceCallCounts,
    ));
    const query = (c.req.query('query') ?? '').trim().toLocaleLowerCase('ja-JP');
    const ownerScoped = serialized.filter(
      (item) => owner !== 'me' || item.createdBy === access.staffId,
    );
    const filtered = ownerScoped.filter((item) => {
      if (query && ![
        item.name,
        ...item.usedIn.map((reference) => reference.name),
      ].some((value) => value.toLocaleLowerCase('ja-JP').includes(query))) return false;
      if (usage === 'used' && item.usedIn.length === 0) return false;
      if (usage === 'unused' && item.usedIn.length > 0) return false;
      if (match === 'matched' && !(typeof item.matchCount === 'number' && item.matchCount > 0)) return false;
      if (match === 'zero' && item.matchCount !== 0) return false;
      return true;
    });
    const page = filtered.slice(offset, offset + limit);
    const summary = {
      total: ownerScoped.length,
      usedInBroadcasts: ownerScoped.filter((item) =>
        item.usedIn.some((reference) => reference.kind === 'broadcast')).length,
      zeroMatches: ownerScoped.filter((item) => item.matchCount === 0).length,
      callsThisMonth: ownerScoped.reduce((total, item) => total + item.callCountThisMonth, 0),
    };
    const pagination = {
      total: filtered.length,
      limit,
      cursor: String(offset),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
    };
    return c.json({
      success: true,
      // data は既存画面との互換性のため配列のまま維持する。
      data: page,
      items: page,
      summary,
      pagination,
    });
  } catch (err) {
    throw err;
  }
};

export const get__api_saved_searches_id_3 = async (c: Context<Env, "/api/saved-searches/:id">) => {
    try {
      const access = await savedSearchAccess(c);
      if (access instanceof Response) return access;
      const row = await getSavedSearchById(c.env.DB, c.req.param('id'), access.lineAccountId);
      if (!row || !canReadSavedSearch(row, access)) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      const [match, references, callCounts, referenceCallCounts] = await Promise.all([
        savedSearchMatchForRow(c.env.DB, row, access.lineAccountId),
        getSavedSearchReferences(c.env.DB, [row.id], access.lineAccountId),
        getSavedSearchUsageCounts(c.env.DB, [row.id], access.lineAccountId),
        getSavedSearchReferenceUsageCounts(c.env.DB, [row.id], access.lineAccountId),
      ]);
      return c.json({
        success: true,
        data: savedSearchDetail(
          row,
          match,
          references,
          callCounts.get(row.id) ?? 0,
          referenceCallCounts,
          access,
        ),
      });
    } catch (err) {
      throw err;
    }
  };

export const post__api_saved_searches_preview_4 = async (c: Context<Env, "/api/saved-searches/preview">) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const requestedAccount = typeof body.lineAccountId === 'string'
        ? body.lineAccountId.trim()
        : undefined;
      const access = await savedSearchAccess(c, requestedAccount);
      if (access instanceof Response) return access;
      const savedSearchId = typeof body.savedSearchId === 'string'
        ? body.savedSearchId.trim()
        : '';
      const row = savedSearchId
        ? await getSavedSearchById(c.env.DB, savedSearchId, access.lineAccountId)
        : null;
      if (savedSearchId && (!row || !canReadSavedSearch(row, access))) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      const currentRevision = row ? Number(row.revision ?? 1) : 0;
      if (body.revision !== undefined
        && (!Number.isInteger(Number(body.revision)) || Number(body.revision) < 1)) {
        return inputError(c, { success: false, error: '確認する版が正しくありません' }, 400, ["revision"]);
      }
      if (row && body.revision !== undefined && Number(body.revision) !== currentRevision) {
        return c.json({
          success: false,
          code: 'SAVED_SEARCH_REVISION_CONFLICT',
          error: 'ほかの担当者が先に変更しました。最新の内容を読み直してください',
          data: { currentRevision },
        }, 409);
      }
      let rawConditions = body.conditions;
      if (rawConditions === undefined && row) {
        try {
          rawConditions = JSON.parse(row.conditions_json);
        } catch {
          return inputError(c, { success: false, error: '保存した検索の条件が壊れています' }, 422, ["conditions","savedSearchId","lineAccountId"]);
        }
      }
      const conditions = validateSearchConditions(rawConditions);
      if (!conditions.ok) return inputError(c, { success: false, error: conditions.error }, 422, ["conditions"]);
      const [match, references, callCounts, referenceCallCounts] = await Promise.all([
        getSavedSearchMatchPreview(c.env.DB, conditions.value, access.lineAccountId),
        row ? getSavedSearchReferences(c.env.DB, [row.id], access.lineAccountId) : Promise.resolve([]),
        row ? getSavedSearchUsageCounts(c.env.DB, [row.id], access.lineAccountId) : Promise.resolve(new Map<string, number>()),
        row ? getSavedSearchReferenceUsageCounts(c.env.DB, [row.id], access.lineAccountId) : Promise.resolve(new Map<string, number>()),
      ]);
      if (row) {
        return c.json({
          success: true,
          data: {
            ...savedSearchDetail(
              { ...row, conditions_json: JSON.stringify(conditions.value) },
              match,
              references,
              callCounts.get(row.id) ?? 0,
              referenceCallCounts,
              access,
            ),
            conditions: conditions.value,
          },
        });
      }
      return c.json({
        success: true,
        data: {
          savedSearchId: null,
          conditions: conditions.value,
          revision: 0,
          scope: 'friends',
          accountScope: { type: 'line_account', id: access.lineAccountId },
          owner: { id: access.staffId, isCurrentUser: true },
          match,
          usedIn: [],
          canDelete: false,
          callCountThisMonth: 0,
        },
      });
    } catch (err) {
      throw err;
    }
  };

export const post__api_saved_searches_5 = async (c: Context<Env, "/api/saved-searches">) => {
  try {
    const staff = c.get('staff');
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return inputError(c, { success: false, error: '名前を入力してください' }, 400, ["name"]);
    const format = requestedConditionFormat(c);
    if (format instanceof Response) return format;

    // 上限を先に見る。条件の検証を通してから弾くと、書いた条件が無駄になる。
    const access = await savedSearchAccess(c);
    if (access instanceof Response) return access;
    const count = await countSavedSearches(c.env.DB, {
      scope: 'friends',
      conditionFormat: format,
      createdBy: staff.id,
      lineAccountId: access.lineAccountId,
    });
    if (count >= SAVED_SEARCH_LIMIT) {
      return inputError(c, {
          success: false,
          error: `保存できる検索は ${SAVED_SEARCH_LIMIT} 件までです。使っていないものを削除してください。`,
        }, 422, []);
    }

    const conditions = validateConditionsForFormat(format, body.conditions);
    if (!conditions.ok) return inputError(c, { success: false, error: conditions.error }, 422, ["conditions"]);

    if (body.scope !== undefined && body.scope !== 'friends') {
      return inputError(c, { success: false, error: '保存した条件の種類が一致しません' }, 400, ["scope"]);
    }
    if (body.isShared === true && staff.role === 'staff') {
      return c.json({ success: false, error: '共有の検索を作る権限がありません' }, 403);
    }

    const saved = await createSavedSearch(c.env.DB, {
      name,
      scope: 'friends',
      conditionFormat: format,
      conditions: conditions.value,
      createdBy: staff.id,
      lineAccountId: access.lineAccountId,
      isShared: body.isShared === true,
      displayOrder: Number(body.displayOrder ?? 0),
    });
    const insights = format === 'search_v1'
      ? await getSavedSearchMatchInsights(c.env.DB, [saved], access.lineAccountId)
      : new Map<string, SavedSearchMatchInsight>();
    return c.json({
      success: true,
      data: serializeSearch(saved, insights.get(saved.id), []),
    }, 201);
  } catch (err) {
    throw err;
  }
};

export const patch__api_saved_searches_reorder_6 = async (c: Context<Env, "/api/saved-searches/reorder">) => {
    try {
      const access = await savedSearchAccess(c);
      if (access instanceof Response) return access;
      const body = await c.req.json<{ ids?: unknown }>();
      if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) {
        return inputError(c, { success: false, error: 'ids must be an array of search ids' }, 400, ["ids"]);
      }
      if (body.ids.length > 500) {
        return inputError(c, { success: false, error: 'too many ids' }, 400, ["ids"]);
      }
      if (new Set(body.ids).size !== body.ids.length) {
        return inputError(c, { success: false, error: 'ids must not contain duplicates' }, 400, ["ids"]);
      }
      await reorderSavedSearches(c.env.DB, access, body.ids as string[]);
      return c.json({ success: true, data: { updated: body.ids.length } });
    } catch (err) {
      throw err;
    }
  };

export const patch__api_saved_searches_id_7 = async (c: Context<Env, "/api/saved-searches/:id">) => {
    try {
      const id = c.req.param('id');
      const format = requestedConditionFormat(c);
      if (format instanceof Response) return format;
      const access = await savedSearchAccess(c);
      if (access instanceof Response) return access;
      const existing = await getSavedSearchById(c.env.DB, id, access.lineAccountId);
      if (!existing || existing.scope !== 'friends'
          || (existing.condition_format ?? 'search_v1') !== format
          || existing.line_account_id !== access.lineAccountId
          || (existing.created_by !== access.staffId && !access.canManageAll)) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }

      const body = await c.req.json<Record<string, unknown>>();
      const expectedRevision = Number(
        body.expectedRevision ?? body.revision ?? existing.revision ?? 1,
      );
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        return inputError(c, { success: false, error: '最新の版を指定してください' }, 400, ["expectedRevision","revision"]);
      }
      const patch: Parameters<typeof updateSavedSearchWithRevision>[4] = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return inputError(c, { success: false, error: '名前を入力してください' }, 400, ["name"]);
        patch.name = name;
      }
      if (body.conditions !== undefined) {
        const conditions = validateConditionsForFormat(format, body.conditions);
        if (!conditions.ok) return inputError(c, { success: false, error: conditions.error }, 422, ["conditions"]);
        patch.conditions = conditions.value;
      }
      if (body.isShared !== undefined) {
        if (!access.canManageAll) {
          return c.json({ success: false, error: '共有設定を変える権限がありません' }, 403);
        }
        patch.isShared = body.isShared === true;
      }
      if (body.displayOrder !== undefined) patch.displayOrder = Number(body.displayOrder);

      const update = await updateSavedSearchWithRevision(
        c.env.DB,
        id,
        access,
        expectedRevision,
        patch,
      );
      if (update.status === 'not_found') {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      if (update.status === 'conflict') {
        const references = await getSavedSearchReferences(
          c.env.DB,
          [update.current.id],
          access.lineAccountId,
        );
        return c.json({
          success: false,
          code: 'SAVED_SEARCH_REVISION_CONFLICT',
          error: 'ほかの担当者が先に変更しました。最新の内容を読み直してください',
          data: {
            currentRevision: Number(update.current.revision ?? 1),
            usedIn: serializeSearch(update.current, undefined, references).usedIn,
          },
        }, 409);
      }
      const saved = update.search;
      const [insights, references, callCounts, referenceCallCounts] = await Promise.all([
        format === 'search_v1'
          ? getSavedSearchMatchInsights(c.env.DB, [saved], access.lineAccountId)
          : Promise.resolve(new Map<string, SavedSearchMatchInsight>()),
        getSavedSearchReferences(c.env.DB, [saved.id], access.lineAccountId),
        getSavedSearchUsageCounts(c.env.DB, [saved.id], access.lineAccountId),
        getSavedSearchReferenceUsageCounts(c.env.DB, [saved.id], access.lineAccountId),
      ]);
      return c.json({
        success: true,
        data: serializeSearch(
          saved,
          insights.get(saved.id),
          references,
          callCounts.get(saved.id) ?? 0,
          referenceCallCounts,
        ),
      });
    } catch (err) {
      throw err;
    }
  };

export const delete__api_saved_searches_id_8 = async (c: Context<Env, "/api/saved-searches/:id">) => {
    try {
      const format = requestedConditionFormat(c);
      if (format instanceof Response) return format;
      const access = await savedSearchAccess(c);
      if (access instanceof Response) return access;
      const id = c.req.param('id');
      const existing = await getSavedSearchById(c.env.DB, id, access.lineAccountId);
      if (!existing || existing.scope !== 'friends'
          || (existing.condition_format ?? 'search_v1') !== format
          || existing.line_account_id !== access.lineAccountId
          || (existing.created_by !== access.staffId && !access.canManageAll)) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      const references = await getSavedSearchReferences(c.env.DB, [id], access.lineAccountId);
      if (references.length > 0) {
        return c.json({
          success: false,
          error: `この検索は${references.length}件で使用中です。使用先を外してから削除してください。`,
          data: { usedIn: serializeSearch(existing, undefined, references).usedIn },
        }, 409);
      }
      const deleted = await deleteSavedSearch(c.env.DB, id, access);
      if (!deleted) return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      return c.json({ success: true, data: null });
    } catch (err) {
      if (err instanceof Error && /foreign key constraint/i.test(err.message)) {
        return c.json({ success: false, error: 'この検索は使用中のため削除できません' }, 409);
      }
      throw err;
    }
  };

export const get__api_login_audit_9 = async (c: Context<Env, "/api/login-audit">) => {
  try {
    const rawAction = c.req.query('action');
    const action = (LOGIN_AUDIT_ACTIONS as readonly string[]).includes(rawAction ?? '')
      ? (rawAction as LoginAuditAction)
      : undefined;
    const items = await getLoginAudit(c.env.DB, {
      adminUserId: c.req.query('userId') || undefined,
      action,
      limit: listQueryNumber(c.req.query('limit'), 100),
    });
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    const staffById = new Map((await getStaffMembers(c.env.DB, tenantId)).map((member) => [member.id, member]));
    return c.json({
      success: true,
      data: items.map((row: LoginAuditRow) => ({
        id: row.id,
        adminUserId: row.admin_user_id,
        userName: row.admin_user_id ? staffById.get(row.admin_user_id)?.name ?? '不明なユーザー' : '不明なユーザー',
        role: row.admin_user_id
          ? (staffById.get(row.admin_user_id)?.access_level === 'read_only'
              ? 'viewer'
              : staffById.get(row.admin_user_id)?.role === 'staff' ? 'staff' : 'admin')
          : null,
        lineLinked: row.admin_user_id ? Boolean(staffById.get(row.admin_user_id)?.line_user_id) : false,
        isActive: row.admin_user_id ? Boolean(staffById.get(row.admin_user_id)?.is_active) : false,
        action: row.action,
        screen: row.screen,
        // IPは残すが、一覧では末尾を伏せる。監査に必要なのは
        // 「いつもと違うところから入っていないか」で、完全な値は要らない。
        ip: row.ip ? maskIp(row.ip) : null,
        connectionSource: [row.ip ? maskIp(row.ip) : null, row.user_agent ? row.user_agent.slice(0, 42) : null].filter(Boolean).join(' / ') || null,
        result: row.result,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    throw err;
  }
};

export const get__api_folders_10 = async (c: Context<Env, "/api/folders">) => {
  try {
    const raw = c.req.query('kind');
    if (raw && !isFolderKind(raw)) {
      return c.json({ success: false, error: '知らないフォルダの種類です' }, 400);
    }
    const kind = raw && isFolderKind(raw) ? raw : undefined;

    if (kind === 'webinar') {
      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      const requestedAccountId = c.req.query('account_id')?.trim();
      if (!requestedAccountId) {
        return c.json({ success: false, error: 'account_id_required' }, 400);
      }
      if (!scope.allowedAccountIds.includes(requestedAccountId)) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      const items = await getFolders(c.env.DB, 'webinar', requestedAccountId);
      const counts = await getWebinarFolderCounts(c.env.DB, {
        allowedAccountIds: scope.allowedAccountIds,
        canSeeUnassigned: scope.canSeeUnassigned,
        accountId: requestedAccountId,
      });
      return c.json({
        success: true,
        data: items.map((row) => serializeFolder(row, counts[row.id] ?? 0, counts[row.id] ?? 0)),
      });
    }

    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const requestedAccountId = c.req.query('account_id')?.trim();
    if (requestedAccountId && !scope.allowedAccountIds.includes(requestedAccountId)) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const items = await getFolders(c.env.DB, kind, requestedAccountId, scope);

    // kind を指定しない呼び出しは全種別をまとめて返す口で、往復回数も
    // 数えるべき母集団も定まらないため件数を数えない。呼び出し元は
    // すべて kind を指定している（2026-09-11時点で apps/web 側21箇所すべて、
    // apps/web/src/lib/api.ts の folders.list 経由）。増えたら見直すこと。
    if (!kind) {
      return c.json({ success: true, data: items.map((row) => serializeFolder(row)) });
    }

    const itemCounts = await getFolderItemCounts(c.env.DB, kind, {
      allowedAccountIds: requestedAccountId ? [requestedAccountId] : scope.allowedAccountIds,
      // #730: account_id 指定（一覧画面が選んだ1件）は、その1件に閉じた母集団で
      // 数える。未割当の NULL 行は単一アカウントの一覧に一切出ないため含めない。
      canSeeUnassigned: requestedAccountId ? false : scope.canSeeUnassigned,
    });
    return c.json({
      success: true,
      data: items.map((row) => {
        // `itemCounts` が undefined の kind（#730、対応表に無い種別）は
        // 「数えていない」。中身が0件のフォルダは GROUP BY の結果に
        // 現れず `byFolderId[row.id]` も undefined になるため、
        // ここで初めて `0` へ読み替える。「数えていない」と
        // 「数えたら0件だった」を混同しない。
        const itemCount = itemCounts === undefined ? undefined : (itemCounts.byFolderId[row.id] ?? 0);
        return serializeFolder(row, undefined, itemCount);
      }),
      // 一覧の「未分類」タブと同じ母集団。itemCounts が無い kind（#730）は
      // 未分類件数も数えていないので、キーごと省く。
      ...(itemCounts === undefined ? {} : { unfiledCount: itemCounts.unfiled }),
    });
  } catch (err) {
    throw err;
  }
};
