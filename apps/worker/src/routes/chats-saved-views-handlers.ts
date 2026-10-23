import { logger } from '@line-crm/shared/server';
import { countInboxSavedViewMatches } from './inbox-saved-view-matches.js';
import { serializeInboxSavedView } from '../services/inbox-saved-view-response.js';
import { inputError } from '../lib/input-errors.js';

import { getOperatorById, getChatById, createChat, getFriendById, getSavedSearches, getSavedSearchById, createSavedSearch, updateSavedSearch, deleteSavedSearch, validateInboxSavedViewConditions, jstNow } from '@line-crm/db';
import type { Env } from '../worker-env.js';

import { canAccessAllLineAccounts } from '../services/account-access.js';
import { inboxEventStatement, inboxNoteStatement, isInboxStatus } from '../services/inbox-events.js';
import { fireEvent } from '../services/event-bus.js';
import { inboxSavedViewAccess, EMPTY_INBOX_SAVED_VIEW_CONDITIONS, resolveOrCreateChat, clampLoadingSeconds, resolveFriendAndAccessToken, startLoadingAnimation } from './chats-definition.js';
import type { Context } from 'hono';

export const get__api_inbox_saved_views_1 = async (c: Context<Env, "/api/inbox/saved-views">) => {
  const access = await inboxSavedViewAccess(c);
  if (access instanceof Response) return access;
  const rows = await getSavedSearches(c.env.DB, 'chats', access);
  const visibleRows = rows.filter((row) => row.scope === 'chats'
    && (row.line_account_id === access.lineAccountId
      ? access.canManageAll || Boolean(row.is_shared) || row.created_by === access.staffId
      : row.line_account_id === null && row.created_by === access.staffId));
  const counts = await Promise.all(visibleRows.map(async (row) => {
    const parsed = validateInboxSavedViewConditions(JSON.parse(row.conditions_json) as unknown);
    return countInboxSavedViewMatches(c.env.DB, {
      lineAccountId: access.lineAccountId,
      staffId: access.staffId,
      canSeeUnassigned: access.canSeeUnassigned,
      // 受信箱より前の `{ all, any }` 行は、画面と同じく「絞りなし」へ倒す。
      conditions: parsed.ok ? parsed.value : EMPTY_INBOX_SAVED_VIEW_CONDITIONS,
    });
  }));
  return c.json({
    success: true,
    data: visibleRows.map((row, index) => serializeInboxSavedView(row, counts[index])),
  });
};

export const post__api_inbox_saved_views_2 = async (c: Context<Env, "/api/inbox/saved-views">) => {
  const staff = c.get('staff');
  const access = await inboxSavedViewAccess(c);
  if (access instanceof Response) return access;
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return inputError(c, { success: false, error: '名前を入力してください' }, 400, ["name"]);
  if (name.length > 40) return inputError(c, { success: false, error: '名前は40文字以内で入力してください' }, 400, ["name"]);
  const conditions = validateInboxSavedViewConditions(body.conditions);
  if (!conditions.ok) return inputError(c, { success: false, error: conditions.error }, 422, ["conditions"]);
  const isShared = body.isShared === true;
  if (isShared && staff.role === 'staff') {
    return c.json({ success: false, error: '共有の検索を作る権限がありません' }, 403);
  }
  const rows = await getSavedSearches(c.env.DB, 'chats', access);
  if (rows.filter((row) => row.created_by === staff.id).length >= 50) {
    return inputError(c, { success: false, error: '保存できる検索は50件までです' }, 422, []);
  }
  if (rows.some((row) => row.created_by === staff.id && row.name === name)) {
    return c.json({ success: false, error: '同じ名前の保存検索があります' }, 409);
  }
  const saved = await createSavedSearch(c.env.DB, {
    name,
    scope: 'chats',
    conditions: conditions.value,
    createdBy: staff.id,
    lineAccountId: access.lineAccountId,
    isShared,
    displayOrder: body.isFavorite === true ? -1 : 0,
  });
  return c.json({ success: true, data: serializeInboxSavedView(saved) }, 201);
};

export const patch__api_inbox_saved_views_id_3 = async (c: Context<Env, "/api/inbox/saved-views/:id">) => {
  const staff = c.get('staff');
  const access = await inboxSavedViewAccess(c);
  if (access instanceof Response) return access;
  const existing = await getSavedSearchById(c.env.DB, c.req.param('id'), access.lineAccountId);
  if (!existing || existing.scope !== 'chats' || existing.line_account_id !== access.lineAccountId) {
    return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  }
  if (existing.created_by !== staff.id && staff.role === 'staff') {
    return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  }
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));
  const patch: Parameters<typeof updateSavedSearch>[3] = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return inputError(c, { success: false, error: '名前を入力してください' }, 400, ["name"]);
    if (name.length > 40) return inputError(c, { success: false, error: '名前は40文字以内で入力してください' }, 400, ["name"]);
    const rows = await getSavedSearches(c.env.DB, 'chats', access);
    if (rows.some((row) => row.id !== existing.id && row.created_by === existing.created_by && row.name === name)) {
      return c.json({ success: false, error: '同じ名前の保存検索があります' }, 409);
    }
    patch.name = name;
  }
  if (body.conditions !== undefined) {
    const conditions = validateInboxSavedViewConditions(body.conditions);
    if (!conditions.ok) return inputError(c, { success: false, error: conditions.error }, 422, ["conditions"]);
    patch.conditions = conditions.value;
  }
  if (body.isShared !== undefined) {
    if (staff.role === 'staff') return c.json({ success: false, error: '共有設定を変える権限がありません' }, 403);
    patch.isShared = body.isShared === true;
  }
  if (body.isFavorite !== undefined) {
    patch.displayOrder = body.isFavorite === true ? -1 : 0;
  }
  const saved = await updateSavedSearch(c.env.DB, existing.id, access, patch);
  if (!saved) return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  return c.json({ success: true, data: serializeInboxSavedView(saved!) });
};

export const delete__api_inbox_saved_views_id_4 = async (c: Context<Env, "/api/inbox/saved-views/:id">) => {
  const staff = c.get('staff');
  const access = await inboxSavedViewAccess(c);
  if (access instanceof Response) return access;
  const existing = await getSavedSearchById(c.env.DB, c.req.param('id'), access.lineAccountId);
  if (!existing || existing.scope !== 'chats' || existing.line_account_id !== access.lineAccountId
      || (existing.created_by !== staff.id && staff.role === 'staff')) {
    return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  }
  const deleted = await deleteSavedSearch(c.env.DB, existing.id, access);
  if (!deleted) return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  return c.json({ success: true, data: null });
};

export const post__api_chats_5 = async (c: Context<Env, "/api/chats">) => {
  try {
    const body = await c.req.json<{ friendId: string; operatorId?: string; lineAccountId?: string | null }>();
    if (!body.friendId) return inputError(c, { success: false, error: 'friendId is required' }, 400, ["friendId"]);
    if (body.lineAccountId !== null && body.lineAccountId !== undefined
      && (!body.lineAccountId
        || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId]))) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const item = await createChat(c.env.DB, body);
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE chats SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, friendId: item.friend_id, status: item.status } }, 201);
  } catch (err) {
    throw err;
  }
};

export const put__api_chats_id_6 = async (c: Context<Env, "/api/chats/:id">) => {
  try {
    const id = c.req.param('id');
    const resolved = await resolveOrCreateChat(c.env.DB, id);
    if (!resolved) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{
      operatorId?: string | null;
      status?: string;
      notes?: string;
      revision?: number;
      reason?: string;
    }>();
    if (body.status !== undefined && !isInboxStatus(body.status)) {
      return inputError(c, { success: false, error: '対応状態が正しくありません' }, 400, ["status"]);
    }
    if (body.notes !== undefined && body.notes.length > 10_000) {
      return inputError(c, { success: false, error: '内部メモは10,000文字以内で入力してください' }, 400, ["notes"]);
    }
    if (body.operatorId) {
      const operator = await getOperatorById(c.env.DB, body.operatorId);
      if (!operator || !operator.is_active) {
        return inputError(c, { success: false, error: '担当者が見つかりません' }, 400, ["operatorId"]);
      }
    }

    const expectedRevision = body.revision ?? resolved.revision;
    if (expectedRevision !== resolved.revision) {
      return c.json({
        success: false,
        error: 'ほかの担当者が先に更新しました。最新の内容を確認してください',
        code: 'REVISION_CONFLICT',
        data: { revision: resolved.revision },
      }, 409);
    }

    const sets: string[] = [];
    const bindings: unknown[] = [];
    const events: D1PreparedStatement[] = [];
    const now = jstNow();
    const correlationId = crypto.randomUUID();
    const eventGuard = {
      table: 'chats' as const,
      id: resolved.id,
      revision: expectedRevision + 1,
      updatedAt: now,
    };
    if (body.operatorId !== undefined && body.operatorId !== resolved.operator_id) {
      sets.push('operator_id = ?');
      bindings.push(body.operatorId);
      events.push(inboxEventStatement(c.env.DB, {
        channel: 'line', conversationId: resolved.friend_id, eventType: 'assignment',
        before: { operatorId: resolved.operator_id }, after: { operatorId: body.operatorId },
        actorStaffId: c.get('staff').id, reason: body.reason, correlationId, createdAt: now,
        guard: eventGuard,
      }));
    }
    if (body.status !== undefined && body.status !== resolved.status) {
      sets.push('status = ?');
      bindings.push(body.status);
      events.push(inboxEventStatement(c.env.DB, {
        channel: 'line', conversationId: resolved.friend_id, eventType: 'status',
        before: { status: resolved.status }, after: { status: body.status },
        actorStaffId: c.get('staff').id, reason: body.reason, correlationId, createdAt: now,
        guard: eventGuard,
      }));
    }
    if (body.notes !== undefined && body.notes !== (resolved.notes ?? '')) {
      const notes = body.notes.trim();
      sets.push('notes = ?');
      bindings.push(notes || null);
      events.push(inboxEventStatement(c.env.DB, {
        channel: 'line', conversationId: resolved.friend_id, eventType: 'note',
        before: { hasNote: Boolean(resolved.notes) }, after: { hasNote: Boolean(notes) },
        actorStaffId: c.get('staff').id, reason: body.reason, correlationId, createdAt: now,
        guard: eventGuard,
      }));
      if (notes) {
        events.push(inboxNoteStatement(c.env.DB, {
          channel: 'line', conversationId: resolved.friend_id, body: notes,
          actorStaffId: c.get('staff').id, createdAt: now, guard: eventGuard,
        }));
      }
    }
    if (sets.length > 0) {
      sets.push('revision = revision + 1', 'updated_at = ?');
      bindings.push(now, resolved.id, expectedRevision);
      const [updateResult] = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE chats SET ${sets.join(', ')} WHERE id = ? AND revision = ?`,
        ).bind(...bindings),
        ...events,
      ]);
      if ((updateResult.meta?.changes ?? 0) !== 1) {
        return c.json({
          success: false,
          error: 'ほかの担当者が先に更新しました。最新の内容を確認してください',
          code: 'REVISION_CONFLICT',
        }, 409);
      }
      if (body.operatorId !== undefined
        && body.operatorId !== null
        && body.operatorId !== resolved.operator_id) {
        const assignedFriend = await getFriendById(c.env.DB, resolved.friend_id);
        await fireEvent(c.env.DB, 'staff_assigned', {
          sourceEventId: correlationId,
          sourceKind: 'inbox_assignment',
          occurredAt: now,
          friendId: resolved.friend_id,
          eventData: { staffId: body.operatorId },
        }, undefined, assignedFriend?.line_account_id).catch((error) => {
          logger.error("chats.chats_id_put_failed");
        });
      }
    }
    const updated = await getChatById(c.env.DB, resolved.id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      // 公開 ID は friend_id に統一
      data: {
        id: updated.friend_id,
        friendId: updated.friend_id,
        operatorId: updated.operator_id,
        status: updated.status,
        notes: updated.notes,
        revision: updated.revision,
      },
    });
  } catch (err) {
    throw err;
  }
};

export const post__api_chats_id_loading_7 = async (c: Context<Env, "/api/chats/:id/loading">) => {
  try {
    const chatId = c.req.param('id');
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let loadingSecondsInput: number | undefined;
    try {
      const body = await c.req.json<{ loadingSeconds?: number }>();
      loadingSecondsInput = body.loadingSeconds;
    } catch {
      loadingSecondsInput = undefined;
    }
    const loadingSeconds = clampLoadingSeconds(loadingSecondsInput);

    const { friend, accessToken } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      'chats.loading-animation',
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    await startLoadingAnimation(
      accessToken,
      friend.line_user_id,
      loadingSeconds,
    );

    return c.json({ success: true, data: { started: true, loadingSeconds } });
  } catch (err) {
    logger.error("chats.chats_id_loading_post_failed");
    const message = err instanceof Error ? err.message : 'Internal server error';
    throw err;
  }
};
