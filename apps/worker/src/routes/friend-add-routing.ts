import { Hono } from 'hono';
import type { Context } from 'hono';
import { getTags } from '@line-crm/db';
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

/**
 * 友だち追加時の配信の振り分け（設計 V2 4-6）。
 *
 * 置き場は `account_settings`。`feature-settings.ts` と同じ判断で、
 * 新しいテーブルは作っていない。
 */
const friendAddRouting = new Hono<Env>();

function getAccountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || null;
}

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
