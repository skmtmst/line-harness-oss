import { Hono, type Context } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { getFriendById, getLineAccountById, recordRichMenuAssignment } from '@line-crm/db';
import type { Env } from '../index.js';
import { resolveLineToken } from '../services/line-token.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';

const richMenus = new Hono<Env>();

class LineAccountRequiredError extends Error {}

/** Resolve LINE access token only after confirming the requested/default account is visible. */
async function resolveLineClient(c: Context<Env>): Promise<LineClient> {
  const accountId = c.req.query('accountId');
  if (accountId) {
    const account = await getLineAccountById(c.env.DB, accountId);
    if (account) return new LineClient(account.channel_access_token);
    throw new LineAccountRequiredError('LINE account not found');
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.canSeeUnassigned) {
    throw new LineAccountRequiredError('accountId is required');
  }
  return new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
}

function richMenuError(c: Context<Env>, prefix: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof LineAccountRequiredError) {
    return c.json({ success: false, error: message }, 400);
  }
  console.error(`${prefix}:`, message);
  return c.json({ success: false, error: `${prefix}: ${message}` }, 500);
}

// GET /api/rich-menus — list all rich menus from LINE API
richMenus.get('/api/rich-menus', async (c) => {
  try {
    const lineClient = await resolveLineClient(c);
    const result = await lineClient.getRichMenuList();
    return c.json({ success: true, data: result.richmenus ?? [] });
  } catch (err) {
    return richMenuError(c, 'Failed to fetch rich menus', err);
  }
});

// POST /api/rich-menus — create a rich menu via LINE API
richMenus.post('/api/rich-menus', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json();
    const lineClient = await resolveLineClient(c);
    const result = await lineClient.createRichMenu(body);
    return c.json({ success: true, data: result }, 201);
  } catch (err) {
    return richMenuError(c, 'Failed to create rich menu', err);
  }
});

// DELETE /api/rich-menus/:id — delete a rich menu
richMenus.delete('/api/rich-menus/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const lineClient = await resolveLineClient(c);
    await lineClient.deleteRichMenu(richMenuId);
    return c.json({ success: true, data: null });
  } catch (err) {
    return richMenuError(c, 'Failed to delete rich menu', err);
  }
});

// POST /api/rich-menus/:id/default — set rich menu as default for all users
richMenus.post('/api/rich-menus/:id/default', requireRole('owner', 'admin'), async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const lineClient = await resolveLineClient(c);
    await lineClient.setDefaultRichMenu(richMenuId);
    return c.json({ success: true, data: null });
  } catch (err) {
    return richMenuError(c, 'Failed to set default rich menu', err);
  }
});

// POST /api/friends/:friendId/rich-menu — link rich menu to a specific friend
richMenus.post('/api/friends/:friendId/rich-menu', requireRole('owner', 'admin'), async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ richMenuId: string }>();

    if (!body.richMenuId) {
      return c.json({ success: false, error: 'richMenuId is required' }, 400);
    }

    const db = c.env.DB;
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    let accountToken: string | null = null;
    const friendAccountId = (friend as unknown as Record<string, string | null>).line_account_id;
    if (friendAccountId) {
      const account = await getLineAccountById(db, friendAccountId);
      accountToken = account?.channel_access_token ?? null;
    }
    const accessToken = resolveLineToken({
      accountToken,
      defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      accountId: friendAccountId ?? null,
      context: 'rich-menus.link-friend',
    });
    const lineClient = new LineClient(accessToken);
    await lineClient.linkRichMenuToUser(friend.line_user_id, body.richMenuId);
    if (friendAccountId) {
      await recordRichMenuAssignment(db, {
        friendId,
        lineAccountId: friendAccountId,
        lineRichMenuId: body.richMenuId,
        reasonKind: 'manual_friend_link',
      });
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/friends/:friendId/rich-menu error:', message);
    return c.json({ success: false, error: `Failed to link rich menu to friend: ${message}` }, 500);
  }
});

// DELETE /api/friends/:friendId/rich-menu — unlink rich menu from a specific friend
richMenus.delete('/api/friends/:friendId/rich-menu', requireRole('owner', 'admin'), async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const db = c.env.DB;

    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    let accountToken: string | null = null;
    const friendAccId = (friend as unknown as Record<string, string | null>).line_account_id;
    if (friendAccId) {
      const account = await getLineAccountById(c.env.DB, friendAccId);
      accountToken = account?.channel_access_token ?? null;
    }
    const accessToken = resolveLineToken({
      accountToken,
      defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      accountId: friendAccId ?? null,
      context: 'rich-menus.unlink-friend',
    });
    const lineClient = new LineClient(accessToken);
    await lineClient.unlinkRichMenuFromUser(friend.line_user_id);
    if (friendAccId) {
      await recordRichMenuAssignment(db, {
        friendId,
        lineAccountId: friendAccId,
        lineRichMenuId: null,
        reasonKind: 'manual_friend_unlink',
      });
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('DELETE /api/friends/:friendId/rich-menu error:', message);
    return c.json({ success: false, error: `Failed to unlink rich menu from friend: ${message}` }, 500);
  }
});

/**
 * 友だちのリッチメニュー取得の短時間キャッシュ (#496-13)。
 *
 * 取得のたびに LINE API を最大3本（個別→既定→一覧）叩くと、列挙で
 * 制限・課金を消費される。認可の検査は毎回行い、通った後だけここを見る。
 */
const FRIEND_RICH_MENU_CACHE_TTL_MS = 60 * 1000;
const friendRichMenuCache = new Map<
  string,
  { at: number; data: { id: string | null; name: string | null; isDefault: boolean } }
>();

/** Test-only: キャッシュを消して単体テスト同士の漏れを防ぐ。 */
export function _resetFriendRichMenuCacheForTest(): void {
  friendRichMenuCache.clear();
}

// GET /api/friends/:friendId/rich-menu — get rich menu currently linked to a friend
richMenus.get('/api/friends/:friendId/rich-menu', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const db = c.env.DB;

    const friend = await getFriendById(db, friendId);
    const friendAccId = (friend as unknown as Record<string, string | null> | null)?.line_account_id ?? null;
    // 認可: 隣の GET /api/friends/:id と同じく、見られる友だちだけ。
    // 存在の有無は 404 に倒して、ID列挙の手がかりを漏らさない (#496-13)。
    if (!friend || !await canAccessAllLineAccounts(db, c.get('staff'), [friendAccId])) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const cached = friendRichMenuCache.get(friendId);
    if (cached && Date.now() - cached.at < FRIEND_RICH_MENU_CACHE_TTL_MS) {
      return c.json({ success: true, data: cached.data });
    }

    let accountToken: string | null = null;
    if (friendAccId) {
      const account = await getLineAccountById(db, friendAccId);
      accountToken = account?.channel_access_token ?? null;
    }
    const accessToken = resolveLineToken({
      accountToken,
      defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      accountId: friendAccId ?? null,
      context: 'rich-menus.friend-assignment',
    });
    const lineClient = new LineClient(accessToken);

    // 個別メニュー取得 — 404 (個別未設定) のみ null に正規化。トークン期限切れ
    // / 5xx 等の真のエラーは外側 catch に伝搬させて 500 を返す。null と「取得失敗」
    // を混同すると運用者にデフォルトメニューが偽表示される。
    let userMenuId: string | null = null;
    try {
      const r = await lineClient.getRichMenuIdOfUser(friend.line_user_id);
      userMenuId = r.richMenuId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404')) {
        userMenuId = null;
      } else {
        throw err;
      }
    }

    // 個別未設定ならデフォルトを fallback。getDefaultRichMenuId は client.ts 側で
    // 404 を null に変換済 (Task 1)、その他のエラーは throw され外側 catch に流れる。
    let isDefault = false;
    let effectiveId: string | null = userMenuId;
    if (!userMenuId) {
      effectiveId = await lineClient.getDefaultRichMenuId();
      isDefault = !!effectiveId;
    }

    // メニュー名は LINE API のリストから lookup (rich_menus DB テーブルは無い)
    let name: string | null = null;
    if (effectiveId) {
      try {
        const list = await lineClient.getRichMenuList();
        const found = (list.richmenus ?? []).find((m) => m.richMenuId === effectiveId);
        name = found?.name ?? null;
      } catch {
        // silent — 名前は出せないが id だけは返す
      }
    }

    const data = { id: effectiveId, name, isDefault };
    friendRichMenuCache.set(friendId, { at: Date.now(), data });
    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('GET /api/friends/:friendId/rich-menu error:', message);
    // 内部文言（`${message}`）をそのまま返すと紛れ込むため、利用者向けの定型文にする (#496-13)。
    return c.json({ success: false, error: 'リッチメニューを取得できませんでした' }, 500);
  }
});

export { richMenus };

// POST /api/rich-menus/:id/image — upload rich menu image (accepts base64 body or binary)
richMenus.post('/api/rich-menus/:id/image', requireRole('owner', 'admin'), async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const contentType = c.req.header('content-type') ?? '';

    let imageData: ArrayBuffer;
    let imageContentType: 'image/png' | 'image/jpeg' = 'image/png';

    if (contentType.includes('application/json')) {
      // Accept base64 encoded image in JSON body
      const body = await c.req.json<{ image?: string; imageData?: string; contentType?: string }>();
      const imageBase64 = body.image ?? body.imageData;
      if (!imageBase64) {
        return c.json({ success: false, error: 'image (base64) is required' }, 400);
      }
      // Strip data URI prefix if present
      const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      imageData = bytes.buffer;
      if (body.contentType === 'image/jpeg') imageContentType = 'image/jpeg';
    } else if (contentType.includes('image/')) {
      // Accept raw binary upload
      imageData = await c.req.arrayBuffer();
      imageContentType = contentType.includes('jpeg') || contentType.includes('jpg') ? 'image/jpeg' : 'image/png';
    } else {
      return c.json({ success: false, error: 'Content-Type must be application/json (with base64) or image/png or image/jpeg' }, 400);
    }

    const lineClient = await resolveLineClient(c);
    await lineClient.uploadRichMenuImage(richMenuId, imageData, imageContentType);

    return c.json({ success: true, data: null });
  } catch (err) {
    return richMenuError(c, 'Failed to upload rich menu image', err);
  }
});
