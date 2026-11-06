import type { Context } from 'hono';
import type { Env } from '../../worker-env.js';
import { getWebinarBySlug, getFriendByLineUserIdForAccount, type Webinar } from '@line-crm/db';

import { verifyCallerLineUserId } from '../../services/liff-auth.js';

// 認証 (401) を webinar 存在確認より先に行う (existence oracle 対策)。
// friend はウェビナーのアカウント配下の行を優先する (同一プロバイダーの複数
// アカウントは line_user_id が同一のため、無指定の先頭一致だと別アカウントの
// friend 行に吸われて予約・確認プッシュ・リマインドのアカウントがズレる)。
export async function resolveWebinarCaller(
  c: Context<Env>,
  slug: string,
): Promise<{ webinar: Webinar; friendId: string } | Response> {
  const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!lineUserId) return c.json({ error: 'unauthorized' }, 401);
  const loaded = await loadActiveWebinar(c, slug);
  if (loaded instanceof Response) return loaded;
  if (!await verifyCallerLineUserId(
    c.req.header('Authorization'), c.env, loaded.webinar.account_id,
  )) return c.json({ error: 'unauthorized' }, 401);
  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB, lineUserId, loaded.webinar.account_id,
  );
  if (!friend) return c.json({ error: 'friend_not_found' }, 403);
  return { webinar: loaded.webinar, friendId: friend.id };
}

export async function loadActiveWebinar(
  c: Context<Env>,
  slug: string,
): Promise<{ webinar: Webinar } | Response> {
  const webinar = await getWebinarBySlug(c.env.DB, slug, { activeAccountOnly: true });
  if (!webinar || webinar.status !== 'active') {
    return c.json({ error: 'not_found' }, 404);
  }
  return { webinar };
}
