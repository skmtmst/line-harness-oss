import { Hono } from 'hono';
import { getLineAccounts } from '@line-crm/db';
import { fetchBotProfile } from '../lib/bot-profile.js';
import type { Env } from '../index.js';

export const brand = new Hono<Env>();

/**
 * GET /api/public/brand — ログイン前の画面に出す看板。
 *
 * ログイン画面は認証より手前にあるので /api/line-accounts を叩けない。
 * 名前とアイコンだけを、認証なしで返す入口をここに置く。
 *
 * 出すのは表示名と画像URLの2つだけ。どちらも LINE 上で友だち全員に
 * 見えている公開情報で、鍵・件数・アカウントの一覧といった中の情報は
 * 含めない。「どの公式アカウントの管理画面か」をログイン前に見せるのが
 * この入口の目的なので、その1点に絞っている。
 *
 * アイコンは管理画面で設定した画像（line_accounts.icon_url）を先に見る。
 * 運用側が意図して差し替えたものなので、LINE 側のアイコンより優先する。
 * 設定が無ければ LINE公式アカウントのアイコンに落ちる。
 *
 * 名前は逆で、LINE の表示名を先に見る。DB の name は運用側が付けた
 * 呼び名（「本番」「テスト」など）で、友だちに見えている名前ではない。
 */
brand.get('/api/public/brand', async (c) => {
  // 取れなくても画面は出す。看板が無いだけで、ログインは妨げない。
  const empty = { name: null as string | null, iconUrl: null as string | null };

  try {
    const accounts = await getLineAccounts(c.env.DB);
    // 有効なものを優先し、その中の表示順の先頭。全部止まっていれば先頭。
    // getLineAccounts は display_order ASC で返すので、並べ直しは不要。
    const account = accounts.find((a) => a.is_active === 1) ?? accounts[0];
    if (!account) return c.json({ success: true, data: empty });

    const profile = await fetchBotProfile(account.channel_access_token);

    // LINE API を毎回叩くので、ブラウザ側に短く持たせる。看板が変わるのは
    // まれで、遅れて反映されても困らない。
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({
      success: true,
      data: {
        name: profile.displayName || account.name || null,
        iconUrl: account.icon_url || profile.pictureUrl || null,
      },
    });
  } catch (err) {
    console.error('GET /api/public/brand error:', err);
    return c.json({ success: true, data: empty });
  }
});
