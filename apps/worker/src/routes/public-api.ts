import { Hono, type Context } from 'hono';
import {
  addTagToFriend,
  enrollFriendInScenario,
  getFriendById,
  getTagAddedScenarioIdsForAccount,
  jstNow,
  resolveIntegrationApiToken,
  isLineAccountTenantActive,
  tokenHasScope,
  type IntegrationApiScope,
  type IntegrationApiTokenRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { fireEvent } from '../services/event-bus.js';
import { accountFeatureAvailability } from '../services/feature-enforcement.js';

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
 *
 * 書き込みは外部連携が有効なアカウントだけが使える（R432）。止めている
 * アカウントのトークンで付けようとすると、管理APIと同じ 403
 * FEATURE_DISABLED で止まり、タグは増えない。読み取り（GET tags）は
 * 棚卸しのため止めない。どちらが止まるかは OpenAPI の説明にも書いてある。
 */
publicApi.post('/api/public/v1/friends/:friendId/tags', async (c) => {
  try {
    const auth = await requireToken(c, 'tags:write');
    if ('error' in auth) return auth.error;
    const lineAccountId = auth.token.line_account_id;
    const availability = await accountFeatureAvailability(c.env.DB, lineAccountId, 'external_integrations');
    if (!availability.effectiveEnabled) {
      const code = availability.reason === 'contract_unavailable'
        ? 'FEATURE_NOT_ENTITLED'
        : availability.reason === 'dependency_disabled'
          ? 'FEATURE_DEPENDENCY_DISABLED'
          : 'FEATURE_DISABLED';
      return c.json({
        success: false,
        error: availability.message ?? 'この機能は設定でオフになっています',
        code,
        featureId: availability.featureId,
        reason: availability.reason,
      }, 403);
    }
    const body = await c.req.json<{ tagId?: unknown }>().catch(() => null);
    const tagId = typeof body?.tagId === 'string' ? body.tagId.trim() : '';
    if (!tagId) return c.json({ success: false, error: 'tagId is required' }, 400);

    const db = c.env.DB;
    const friendId = c.req.param('friendId');
    const friend = await getFriendById(db, friendId);
    // 別アカウントの友だちは存在を漏らさず 404。
    if (!friend || friend.line_account_id !== lineAccountId) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const tag = await db.prepare(
      `SELECT id, line_account_id, manual_assignment_allowed FROM tags
        WHERE id = ? AND status = 'active'`,
    ).bind(tagId).first<{ id: string; line_account_id: string | null; manual_assignment_allowed: number }>();
    if (!tag
      || (tag.line_account_id !== null && tag.line_account_id !== lineAccountId)
      || Number(tag.manual_assignment_allowed ?? 1) !== 1) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }

    const added = await addTagToFriend(db, friendId, tagId);
    // 付与の確定時刻を台帳から読み直す。再送でも同じ値になるので、
    // そこから作る発生元IDは安定し、公開版オートメーションの受け口が
    // 同じ出来事と判定できる（R436）。
    const assignedAt = await readTagAssignedAt(db, friendId, tagId);
    if (added) {
      await enrollMissingTagScenarios(db, friendId, tagId, lineAccountId);
      await fireTagChange(db, friendId, tagId, lineAccountId, assignedAt);
    } else {
      // タグだけ残って後続が落ちた前回の分を取り戻す（R433）。
      // 不足の購読だけを作り直す。済んだ分は増やさない。
      // 前回が発火まで届かずに落ちた証拠（今回初めて購読を作った）が
      // あるときだけ発火する。届いたか分からないものを送り直さない。
      const { enrolled } = await enrollMissingTagScenarios(db, friendId, tagId, lineAccountId);
      if (enrolled > 0) {
        await fireTagChange(db, friendId, tagId, lineAccountId, assignedAt);
      }
    }
    return c.json({ success: true, data: { friendId, tagId, added } }, added ? 201 : 200);
  } catch (err) {
    console.error('POST /api/public/v1/friends/:friendId/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 「このタグが付いたら始まる」のうち、友だちと同じアカウントの公開済みだけを
 * 始める（R435）。共通タグをきっかけにした別組織のシナリオは混ぜない。
 * 既に購読がある分は触らない。戻り値は今回初めて作った購読の数。
 */
async function enrollMissingTagScenarios(
  db: D1Database,
  friendId: string,
  tagId: string,
  lineAccountId: string,
): Promise<{ enrolled: number }> {
  let enrolled = 0;
  for (const scenarioId of await getTagAddedScenarioIdsForAccount(db, tagId, lineAccountId)) {
    const existing = await db
      .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
      .bind(friendId, scenarioId)
      .first();
    if (existing) continue;
    // 停止中・未公開・重複は受け付けない（null）。例外にしないのは、
    // 1本の失敗で残りの開始まで巻き添えにしないため。
    const enrollment = await enrollFriendInScenario(db, friendId, scenarioId);
    if (enrollment) enrolled += 1;
  }
  return { enrolled };
}

/** friend_tags の確定時刻。付与のたびに変わらない値を発生元IDの土台にする。 */
async function readTagAssignedAt(db: D1Database, friendId: string, tagId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT assigned_at FROM friend_tags WHERE friend_id = ? AND tag_id = ?`)
    .bind(friendId, tagId)
    .first<{ assigned_at: string | null }>();
  const assignedAt = row?.assigned_at ?? jstNow();
  return /[+-]\d{2}:?\d{2}$|Z$/.test(assignedAt) ? assignedAt : `${assignedAt}+09:00`;
}

/**
 * タグ変化を業務の受け口へ渡す（R436）。
 *
 * V6公開版は発生元の不変IDと所属が分かる出来事だけを受け付ける。
 * IDは「公開の付与:友だち:タグ:確定時刻」で、再送でも同じになる。
 * 旧自動化・加点も同じ1回に乗るので、呼び出し側は重複して呼ばない。
 */
async function fireTagChange(
  db: D1Database,
  friendId: string,
  tagId: string,
  lineAccountId: string,
  assignedAt: string,
): Promise<void> {
  await fireEvent(db, 'tag_change', {
    sourceEventId: `public_tag:${friendId}:${tagId}:${assignedAt}`,
    sourceKind: 'public_api',
    occurredAt: assignedAt,
    friendId,
    eventData: { tagId, action: 'add', source: 'public_api' },
  }, undefined, lineAccountId);
}

export { publicApi };
