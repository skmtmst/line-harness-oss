import { formatYen as sharedFormatYen } from '@line-crm/shared';
import { logger } from '@line-crm/shared/server';
import { LineClient } from '@line-crm/line-sdk';
import { resolveLineToken } from './line-token.js';
import {
  getAffiliateById,
  getFriendById,
  getLineAccountById,
} from '@line-crm/db';

/** 友だち追加と成果承認は、成果を上げた友だちでなくリンク所有者へ通知する。本人の所属アカウントからトークンを解決する。友だち追加の失敗は帰属を止めず、承認通知の失敗は notifyApprovalOnce が実行権を解放し、承認を保ったまま再試行で補う。 */

/** 代替の送信トークン解決に必要な設定だけを受け取る。 */
export interface AffiliateNotifierEnv {
  LINE_CHANNEL_ACCESS_TOKEN: string;
}

/** 参加者・結び付いた友だち・LINE ID・トークンがなければ送信しない。配送エラーは上へ渡し、公開の継続可能な入口で記録する。 */
async function pushAffiliate(
  db: D1Database,
  env: AffiliateNotifierEnv,
  affiliateId: string,
  text: string,
  retryKey?: string,
): Promise<void> {
    const affiliate = await getAffiliateById(db, affiliateId);
    if (!affiliate?.friend_id) return; // 結び付いた友だちがなければ送信先がない。

    const friend = await getFriendById(db, affiliate.friend_id);
    if (!friend?.line_user_id) return;

    // 友だちの所属トークンを優先し、行や値がない場合は環境の既定へ戻す。
    let accountToken: string | null = null;
    let accountId: string | null = friend.line_account_id ?? null;
    if (friend.line_account_id) {
      const account = await getLineAccountById(db, friend.line_account_id);
      // 止めているアカウント宛の通知は送らない（X-1）。
      if (account && !account.is_active) return;
      accountToken = account?.channel_access_token ?? null;
      accountId = account?.id ?? friend.line_account_id;
    }
    const accessToken = resolveLineToken({
      accountToken,
      defaultToken: env.LINE_CHANNEL_ACCESS_TOKEN,
      accountId,
      context: 'affiliate-notifier.push',
    });
    if (!accessToken) return;

    const client = new LineClient(accessToken);
    if (retryKey) await client.pushMessage(friend.line_user_id, [{ type: 'text', text }], retryKey);
    else await client.pushMessage(friend.line_user_id, [{ type: 'text', text }]);
}

/** 友だち追加など、従来の通知は主処理を止めない。 */
export async function notifyAffiliate(db: D1Database, env: AffiliateNotifierEnv, affiliateId: string, text: string): Promise<void> {
  try {
    await pushAffiliate(db, env, affiliateId, text);
  } catch (err) {
    logger.error("affiliate_notifier.notify_affiliate_failed");
  }
}


function formatYen(amount: number): string {
  return sharedFormatYen(amount).replace(/^¥/, '');
}

/**
 * A) 友だち追加通知 — a new friend was added through this affiliate's link.
 *
 * `offerName` is the offer (案件) name, or null for a 汎用リンク (generic link).
 */
export async function notifyAffiliateFriendAdd(
  db: D1Database,
  env: AffiliateNotifierEnv,
  affiliateId: string,
  offerName: string | null,
): Promise<void> {
  const offerLine = offerName && offerName.trim() ? offerName : '汎用リンク';
  const text =
    `🎉 あなたの紹介リンクから友だち追加がありました！\n` +
    `案件: ${offerLine}\n` +
    `『アフィリ』と送るとマイページで実績を確認できます`;
  await notifyAffiliate(db, env, affiliateId, text);
}

/** 案件名がある承認通知だけに固定報酬を含め、案件なしは一般的な承認文だけを送る。 */
export async function notifyAffiliateApproval(
  db: D1Database,
  env: AffiliateNotifierEnv,
  affiliateId: string,
  offerName: string | null,
  rewardAmount: number,
  retryKey?: string,
): Promise<void> {
  let text: string;
  if (offerName && offerName.trim()) {
    text =
      `✅ 成果が承認されました！\n` +
      `案件: ${offerName}\n` +
      `確定報酬: ¥${formatYen(rewardAmount)}\n` +
      `『アフィリ』と送るとマイページで確認できます`;
  } else {
    text =
      `✅ 成果が承認されました！\n` +
      `『アフィリ』と送るとマイページで確認できます`;
  }
  await pushAffiliate(db, env, affiliateId, text, retryKey);
}
