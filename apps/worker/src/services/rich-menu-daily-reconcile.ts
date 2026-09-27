import {
  countScheduledReconcileSince,
  ensureRichMenuPublishRun,
  getLineAccountById,
  getRichMenuGroupWithPages,
  listPublishedRichMenuGroupIds,
  markRichMenuPublishRun,
  toJstString,
} from '@line-crm/db';
import { computeRichMenuDiffs } from '../lib/rich-menu-reconcile.js';
import { createLineApiClient, type LineRichMenuClient } from '../lib/rich-menu-publisher.js';

// K(#822): 毎日の自動照合。公開中の group を1日1回だけ見る。
// 見つけたずれは直さず、実行台帳に残す。直すのは運用者が K-2 画面で行う。
// LINE が読めない group は数えるだけで止めない（次の tick でまた見る）。

export type DailyReconcileDeps = {
  now: Date;
  makeLineClient?: (channelAccessToken: string) => LineRichMenuClient;
  newId?: () => string;
};

/** 日本日の始まり（台帳の started_at と同じ形）。その日の照合済み判定に使う。 */
export function jstDayStart(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = jst.toISOString().slice(0, 10);
  return `${day}T00:00:00.000`;
}

export async function processDailyRichMenuReconcile(
  db: D1Database,
  deps: DailyReconcileDeps,
): Promise<{ checked: number; withDiffs: number; failed: number }> {
  const makeLineClient = deps.makeLineClient ?? createLineApiClient;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const dayStart = jstDayStart(deps.now);
  const day = dayStart.slice(0, 10);

  const groups = await listPublishedRichMenuGroupIds(db);
  let checked = 0;
  let withDiffs = 0;
  let failed = 0;
  for (const { group_id: groupId, account_id: accountId } of groups) {
    if ((await countScheduledReconcileSince(db, groupId, dayStart)) > 0) continue;
    const account = await getLineAccountById(db, accountId);
    if (!account?.channel_access_token) {
      failed += 1;
      continue;
    }
    const group = await getRichMenuGroupWithPages(db, groupId);
    if (!group) continue;
    try {
      const computed = await computeRichMenuDiffs(db, makeLineClient(account.channel_access_token), group);
      const run = await ensureRichMenuPublishRun(db, {
        id: newId(),
        groupId,
        versionId: null,
        idempotencyKey: `scheduled-${day}-${groupId}`,
        mode: 'scheduled_reconcile',
        staffId: null,
        // 記録の時刻は tick の時刻にそろえる（試験で日をまたげるようにする）。
        now: toJstString(deps.now),
      });
      await markRichMenuPublishRun(db, run.id, {
        status: 'succeeded',
        diffsJson: JSON.stringify(computed.diffs.map((d) => d.kind)),
      });
      checked += 1;
      if (computed.diffs.length > 0) withDiffs += 1;
    } catch (error) {
      // LINE障害など。直さず数えるだけ。次の tick でまた見る。
      console.error(JSON.stringify({
        event: 'rich_menu_daily_reconcile_failed', groupId, error: String(error),
      }));
      failed += 1;
    }
  }
  return { checked, withDiffs, failed };
}
