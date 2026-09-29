/*
 * 分析画面で作った一時対象者（analytics_result_audiences）を配信条件で
 * 使うための検証。
 *
 * URL には audienceId だけを載せ、友だちIDは外へ出さない。対象者は
 * 24時間で消えるため、下書き保存・送信開始・予約送信・キュー処理の
 * 各直前で所属アカウントと期限を再確認する。条件の SQL 側（segment-query の
 * analytics_audience 節）も期限とアカウントを評価ごとに確かめるので、
 * ここを通り抜けても期限切れの対象者は誰にも一致しない。
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { SegmentCondition } from './segment-query.js';

export type AnalyticsAudienceBlocker = 'audience_missing' | 'audience_expired';

export class BroadcastAudienceError extends Error {
  constructor(readonly blocker: AnalyticsAudienceBlocker) {
    super(blocker);
    this.name = 'BroadcastAudienceError';
  }
}

/*
 * 条件木から analytics_audience ルールの audienceId をすべて集める。
 * ルールがあって audienceId が空なら壊れた条件なので missing 扱いで拒否する。
 */
export function collectAnalyticsAudienceIds(condition: SegmentCondition | null): string[] {
  const ids = new Set<string>();
  const visit = (node: SegmentCondition | null | undefined) => {
    if (!node) return;
    for (const rule of node.rules ?? []) {
      if (rule.type !== 'analytics_audience') continue;
      const v = rule.value as Record<string, unknown> | null | undefined;
      const id = typeof v?.audienceId === 'string' ? v.audienceId.trim() : '';
      if (id === '') throw new BroadcastAudienceError('audience_missing');
      ids.add(id);
    }
    for (const group of node.groups ?? []) visit(group);
  };
  visit(condition);
  return [...ids];
}

/*
 * 各対象者について、要求アカウントへの所属と期限を再確認する。
 * 他アカウント・消えた対象者は missing、期限切れは expired で拒否する。
 */
export async function assertAnalyticsAudiencesUsable(
  db: D1Database,
  condition: SegmentCondition | null,
  accountId: string | null,
): Promise<void> {
  const audienceIds = collectAnalyticsAudienceIds(condition);
  if (audienceIds.length === 0) return;
  const nowIso = new Date().toISOString();
  for (const audienceId of audienceIds) {
    const row = await db.prepare(
      `SELECT expires_at FROM analytics_result_audiences
        WHERE id = ? AND line_account_id = ?`,
    ).bind(audienceId, accountId ?? '').first<{ expires_at: string }>();
    if (!row) throw new BroadcastAudienceError('audience_missing');
    if (row.expires_at <= nowIso) throw new BroadcastAudienceError('audience_expired');
  }
}
