import type { MessageTemplate, TrackedLink, Friend } from '@line-crm/db';



/** 報酬は要求の計測リンク、未解決なら友だちの初回流入の順で解決する。どちらもなければ null とし、フォームの回答後メッセージへ戻す。D1 なしで試せるよう読取関数を注入する。 */
export interface RewardResolverDeps {
  getFriendById: (db: D1Database, id: string) => Promise<Friend | null>;
  getTrackedLinkById: (db: D1Database, id: string) => Promise<TrackedLink | null>;
  trackedLinkReferralMatchesAccount: (db: D1Database, link: TrackedLink, accountId: string | null) => Promise<boolean>;
  getMessageTemplateById: (db: D1Database, id: string) => Promise<MessageTemplate | null>;
}

export async function resolveRewardTemplate(
  db: D1Database,
  args: { friendId: string; requestedTrackedLinkId: string | null; expectedLineAccountId: string },
  deps: RewardResolverDeps,
): Promise<MessageTemplate | null> {
  // 指定リンクが実在すれば、報酬なしもそのキャンペーンの意図として優先する。別の初回報酬へ戻すのはリンク自体が未解決の場合だけにし、意図しない報酬漏れを防ぐ。
  if (args.requestedTrackedLinkId) {
    const link = await deps.getTrackedLinkById(db, args.requestedTrackedLinkId);
    if (link) {
      // 別アカウントを含め既知リンクの指定は正本とし、別の初回流入へすり替えない。
      if (!await deps.trackedLinkReferralMatchesAccount(db, link, args.expectedLineAccountId)) return null;
      if (!link.reward_template_id) return null;
      return await deps.getMessageTemplateById(db, link.reward_template_id);
    }
  }

  // 指定リンクを解決できない場合だけ、初回の帰属へ戻す。
  const friend = await deps.getFriendById(db, args.friendId);
  if (friend?.first_tracked_link_id) {
    const link = await deps.getTrackedLinkById(db, friend.first_tracked_link_id);
    if (link?.reward_template_id
      && await deps.trackedLinkReferralMatchesAccount(db, link, args.expectedLineAccountId)) {
      const tpl = await deps.getMessageTemplateById(db, link.reward_template_id);
      if (tpl) return tpl;
    }
  }

  return null;
}
