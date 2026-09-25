import { Hono, type Context } from 'hono';
import {
  addTagToFriend,
  enrollFriendInScenario,
  getFriendById,
  getTagAddedScenarioIds,
  resolveIntegrationApiToken,
  isLineAccountTenantActive,
  tokenHasScope,
  type IntegrationApiScope,
  type IntegrationApiTokenRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { fireEvent } from '../services/event-bus.js';

/**
 * 公開API（#939 N-380）。外部システムが `Authorization: Bearer lhp_…` で呼ぶ。
 *
 * 管理画面の認証(authMiddleware)は isPublicApiBoundary が /api/public/v1/ を
 * 素通しにするため、ここには届かない。この route が自分で台帳を照合する。
 * トークンは1つのLINEアカウントにだけ効き、scope でできることを絞る。
 * 受信Webhook(/api/webhooks/incoming/:id/receive)の HMAC とは無関係。
 */

const publicApi = new Hono<Env>();

function bearerToken(c: Context<Env>): string | null {
  const header = c.req.header('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

async function requireToken(
  c: Context<Env>,
  scope: IntegrationApiScope,
): Promise<{ token: IntegrationApiTokenRow } | { error: Response }> {
  const presented = bearerToken(c);
  if (!presented) {
    return { error: c.json({ success: false, error: 'Bearer token is required' }, 401) };
  }
  const token = await resolveIntegrationApiToken(c.env.DB, presented);
  if (!token) {
    return { error: c.json({ success: false, error: 'Invalid or revoked token' }, 401) };
  }
  if (!tokenHasScope(token, scope)) {
    return { error: c.json({ success: false, error: `scope "${scope}" is required` }, 403) };
  }
  if (!await isLineAccountTenantActive(c.env.DB, token.line_account_id)) {
    return {
      error: c.json({
        success: false,
        code: 'TENANT_SUSPENDED',
        error: '現在ご利用いただけません',
      }, 503),
    };
  }
  return { token };
}

/**
 * タグの一覧。トークンのアカウントのタグと共通タグ(所属なし)だけを返す。
 * 外部システムが「付けたいタグのIDを知る」ために使う。
 */
publicApi.get('/api/public/v1/tags', async (c) => {
  try {
    const auth = await requireToken(c, 'tags:read');
    if ('error' in auth) return auth.error;
    const result = await c.env.DB.prepare(
      `SELECT id, name, color
         FROM tags
        WHERE (line_account_id = ? OR line_account_id IS NULL) AND status = 'active'
        ORDER BY display_order ASC, name ASC`,
    ).bind(auth.token.line_account_id).all<{ id: string; name: string; color: string }>();
    return c.json({
      success: true,
      data: (result.results ?? []).map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    });
  } catch (err) {
    console.error('GET /api/public/v1/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 友だちへタグを付ける。管理画面の POST /api/friends/:id/tags と同じ約束:
 * 友だちはトークンのアカウント所属、タグは同じアカウントか共通、
 * 手動付与が禁じられたタグは付けない。付けたら tag_change を発火し、
 * 「このタグが付いたら始まる」シナリオも動かす。
 */
publicApi.post('/api/public/v1/friends/:friendId/tags', async (c) => {
  try {
    const auth = await requireToken(c, 'tags:write');
    if ('error' in auth) return auth.error;
    const body = await c.req.json<{ tagId?: unknown }>().catch(() => null);
    const tagId = typeof body?.tagId === 'string' ? body.tagId.trim() : '';
    if (!tagId) return c.json({ success: false, error: 'tagId is required' }, 400);

    const db = c.env.DB;
    const friendId = c.req.param('friendId');
    const friend = await getFriendById(db, friendId);
    // 別アカウントの友だちは存在を漏らさず 404。
    if (!friend || friend.line_account_id !== auth.token.line_account_id) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const tag = await db.prepare(
      `SELECT id, line_account_id, manual_assignment_allowed FROM tags
        WHERE id = ? AND status = 'active'`,
    ).bind(tagId).first<{ id: string; line_account_id: string | null; manual_assignment_allowed: number }>();
    if (!tag
      || (tag.line_account_id !== null && tag.line_account_id !== auth.token.line_account_id)
      || Number(tag.manual_assignment_allowed ?? 1) !== 1) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }

    const added = await addTagToFriend(db, friendId, tagId);
    if (added) {
      for (const scenarioId of await getTagAddedScenarioIds(db, tagId)) {
        const existing = await db
          .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
          .bind(friendId, scenarioId)
          .first();
        if (!existing) {
          await enrollFriendInScenario(db, friendId, scenarioId);
        }
      }
      await fireEvent(db, 'tag_change', {
        friendId,
        eventData: { tagId, action: 'add', source: 'public_api' },
      }, undefined, auth.token.line_account_id);
    }
    return c.json({ success: true, data: { friendId, tagId, added } }, added ? 201 : 200);
  } catch (err) {
    console.error('POST /api/public/v1/friends/:friendId/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { publicApi };
