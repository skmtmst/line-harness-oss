import { Hono } from 'hono';
import type { Context } from 'hono';
import { getTags, listFriendAddEvents } from '@line-crm/db';
import type {
  FriendAddKind,
  FriendAddAttributionStatus,
  FriendAddRoutingStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  loadFriendAddRouting,
  saveFriendAddRouting,
  normalizeRouting,
  previewFriendAddRouting,
  listFriendAddScenarios,
  classifyFriend,
} from '../services/friend-add-routing.js';
import { FRIEND_ADD_ROUTING_DEFAULT } from '@line-crm/shared';
import { getVisibleLineAccountScope } from '../services/account-access.js';

/**
 * 友だち追加時の配信の振り分け（設計 V2 4-6）。
 *
 * 置き場は `account_settings`。`feature-settings.ts` と同じ判断で、
 * 新しいテーブルは作っていない。
 */
const friendAddRouting = new Hono<Env>();

const EVENT_KINDS = new Set<FriendAddKind>(['first_time', 'returning']);
const ATTRIBUTION_STATUSES = new Set<FriendAddAttributionStatus>(['captured', 'unavailable']);
const ROUTING_STATUSES = new Set<FriendAddRoutingStatus>(['pending', 'completed', 'failed', 'suppressed']);

function getAccountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || null;
}

/** V6の履歴一覧。設定画面とは別に、共通Pencilデザインが直接使える形で返す。 */
friendAddRouting.get(
  '/api/friend-add-routing/events',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

    const rawKind = c.req.query('kind');
    const rawAttribution = c.req.query('attribution_status');
    const rawRouting = c.req.query('routing_status');
    if (rawKind && !EVENT_KINDS.has(rawKind as FriendAddKind)) {
      return c.json({ success: false, error: 'kind が正しくありません' }, 400);
    }
    if (rawAttribution && !ATTRIBUTION_STATUSES.has(rawAttribution as FriendAddAttributionStatus)) {
      return c.json({ success: false, error: 'attribution_status が正しくありません' }, 400);
    }
    if (rawRouting && !ROUTING_STATUSES.has(rawRouting as FriendAddRoutingStatus)) {
      return c.json({ success: false, error: 'routing_status が正しくありません' }, 400);
    }

    try {
      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.ids.includes(accountId)) {
        return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
      }
      const rawLimit = Number.parseInt(c.req.query('limit') ?? '50', 10);
      const data = await listFriendAddEvents(c.env.DB, {
        lineAccountId: accountId,
        limit: Number.isFinite(rawLimit) ? rawLimit : 50,
        cursor: c.req.query('cursor') || null,
        kind: rawKind as FriendAddKind | undefined,
        attributionStatus: rawAttribution as FriendAddAttributionStatus | undefined,
        routingStatus: rawRouting as FriendAddRoutingStatus | undefined,
      });
      return c.json({ success: true, data });
    } catch (err) {
      console.error('GET /api/friend-add-routing/events error:', err);
      return c.json({ success: false, error: '友だち追加履歴を取得できませんでした' }, 500);
    }
  },
);

/**
 * 画面1枚ぶんをまとめて返す。
 *
 * 設定・選べるシナリオ・選べるタグを1回で返す。画面が3回叩くと、
 * 途中で失敗したときに「シナリオ名だけ出ない」ような半端な状態になる。
 */
friendAddRouting.get('/api/friend-add-routing', async (c) => {
  try {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

    const saved = await loadFriendAddRouting(c.env.DB, accountId);
    const scenarios = await listFriendAddScenarios(c.env.DB, accountId);
    const tags = (await getTags(c.env.DB)).map((t) => ({ id: t.id, name: t.name }));

    return c.json({
      success: true,
      data: {
        /** false のときは、いままでどおり friend_add シナリオを全部流している */
        configured: saved !== null,
        routing: saved ?? FRIEND_ADD_ROUTING_DEFAULT,
        scenarios,
        tags,
      },
    });
  } catch (err) {
    console.error('GET /api/friend-add-routing error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAddRouting.put(
  '/api/friend-add-routing',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = getAccountId(c);
      if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

      const body = await c.req.json<unknown>();
      const routing = normalizeRouting((body as { routing?: unknown })?.routing ?? body);

      // ②で「別のシナリオを配信する」を選んだのにシナリオが空だと、
      // 保存はできるのに何も届かない。ここで止める。
      if (routing.returning.mode === 'other' && !routing.returning.scenarioId) {
        return c.json(
          { success: false, error: '「別のシナリオを配信する」を選んだときは、配信するシナリオを決めてください' },
          400,
        );
      }

      // 選んだシナリオが本当にこのアカウントの friend_add シナリオか確かめる。
      // 他アカウントのIDを入れられると、別の店の配信が流れる。
      const allowed = new Set((await listFriendAddScenarios(c.env.DB, accountId)).map((s) => s.id));
      for (const id of [routing.firstTime.scenarioId, routing.returning.scenarioId]) {
        if (id && !allowed.has(id)) {
          return c.json(
            { success: false, error: 'このアカウントで使えないシナリオが指定されています' },
            400,
          );
        }
      }

      await saveFriendAddRouting(c.env.DB, accountId, routing);
      return c.json({ success: true, data: { routing } });
    } catch (err) {
      console.error('PUT /api/friend-add-routing error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

/**
 * テスト実行。**登録も配信もしない。**
 *
 * 指定した友だちが、いまの設定でどちらに振り分けられるかだけを返す。
 * 設計の「テスト実行」がこれ。実際に送ってしまうと、確かめるたびに
 * お客さまへメッセージが飛ぶ。
 */
friendAddRouting.post('/api/friend-add-routing/test', async (c) => {
  try {
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);

    const body = await c.req.json<{ friendId?: string }>();
    if (!body.friendId) return c.json({ success: false, error: 'friendId が必要です' }, 400);

    const friend = await c.env.DB.prepare(
      `SELECT id, unfollow_count, first_followed_at, display_name FROM friends WHERE id = ?`,
    )
      .bind(body.friendId)
      .first<{
        id: string;
        unfollow_count: number | null;
        first_followed_at: string | null;
        display_name: string | null;
      }>();
    if (!friend) return c.json({ success: false, error: '友だちが見つかりません' }, 404);

    const result = await previewFriendAddRouting(c.env.DB, accountId, friend);
    return c.json({
      success: true,
      data: {
        ...result,
        displayName: friend.display_name,
        unfollowCount: friend.unfollow_count ?? 0,
        firstFollowedAt: friend.first_followed_at,
      },
    });
  } catch (err) {
    console.error('POST /api/friend-add-routing/test error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendAddRouting, classifyFriend };
