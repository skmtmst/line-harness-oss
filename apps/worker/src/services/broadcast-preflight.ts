import { INSIGHT_MIN_AUDIENCE } from '@line-crm/db';
import { buildSegmentWhere, type SegmentCondition } from './segment-query.js';

/**
 * 配信前チェック。
 *
 * 送る直前に「何人に届くか」「気をつけることはあるか」を返す。
 * 一斉配信は取り消せないので、押す前に見せる。
 *
 * 送信そのものは何もしない。数えて注意を返すだけ。
 */

export interface PreflightWarning {
  /** 画面での見せ方を分けるための種別 */
  level: 'info' | 'warning';
  message: string;
}

export interface PreflightResult {
  audienceCount: number;
  /** 表示状態で除外された人数。0 なら出さない */
  hiddenExcluded: number;
  warnings: PreflightWarning[];
}

export interface PreflightInput {
  targetType: string;
  targetTagId?: string | null;
  lineAccountId?: string | null;
  /** multi-account-dedup のときの対象アカウント */
  accountIds?: string[];
  /**
   * 詳細条件で絞ったときの条件。
   *
   * 渡さないと、条件を無視して**そのアカウントの全員**を数える。
   * 12人に送るつもりで「312人に届きます」と出たまま送信ボタンを押す、
   * という取り違えが起きる。取り消せない操作の直前に出る数字なので、
   * 送信と同じ条件で数える。
   */
  segmentConditions?: SegmentCondition | null;
}

/**
 * 何人に届くかを数える。
 *
 * 非表示にした友だち（friends.is_hidden = 1）は数えない。
 * 「こちらから見えなくした人」に配信が飛ぶと、非表示にした意味がない。
 */
export async function countAudience(
  db: D1Database,
  input: PreflightInput,
): Promise<{ total: number; hiddenExcluded: number }> {
  const where: string[] = ['f.is_following = 1'];
  const binds: unknown[] = [];

  if (input.targetType === 'multi-account-dedup') {
    const ids = input.accountIds ?? [];
    if (ids.length === 0) return { total: 0, hiddenExcluded: 0 };
    where.push(`f.line_account_id IN (${ids.map(() => '?').join(',')})`);
    binds.push(...ids);
  } else if (input.lineAccountId) {
    where.push('f.line_account_id = ?');
    binds.push(input.lineAccountId);
  }

  if (input.targetType === 'tag') {
    if (!input.targetTagId) return { total: 0, hiddenExcluded: 0 };
    where.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
    binds.push(input.targetTagId);
  }

  if (input.targetType === 'segment' && input.segmentConditions) {
    // 送信と同じ組み立てを使う。別々に書くと、条件を1つ足したときに
    // 「一覧に出る人」と「実際に届く人」がずれる。
    const segment = buildSegmentWhere(input.segmentConditions);
    where.push(`(${segment.sql})`);
    binds.push(...segment.bindings);
  }

  const row = await db
    .prepare(
      `SELECT SUM(CASE WHEN COALESCE(f.is_hidden, 0) = 0 THEN 1 ELSE 0 END) AS total,
              SUM(CASE WHEN COALESCE(f.is_hidden, 0) = 1 THEN 1 ELSE 0 END) AS hidden
         FROM friends f WHERE ${where.join(' AND ')}`,
    )
    .bind(...binds)
    .first<{ total: number | null; hidden: number | null }>();

  return {
    total: Number(row?.total ?? 0),
    hiddenExcluded: Number(row?.hidden ?? 0),
  };
}

/**
 * 注意を組み立てる。
 *
 * 止めない。押すかどうかは人が決める。ここで弾くと、意図して
 * 少人数へ送りたい場合に送れなくなる。
 */
export function buildWarnings(
  audience: { total: number; hiddenExcluded: number },
  opts: { hasRecentSimilar?: boolean } = {},
): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];

  if (audience.total === 0) {
    warnings.push({
      level: 'warning',
      message: '届く人が0人です。絞り込みの条件を見直してください。',
    });
  } else if (audience.total < INSIGHT_MIN_AUDIENCE) {
    // LINEの決まりで、20人未満だと開封もクリックも返ってこない。
    // 送れないわけではないので、注意にとどめる。
    warnings.push({
      level: 'info',
      message: `届く人が${audience.total}人です。${INSIGHT_MIN_AUDIENCE}人未満だと、LINEから開封数・クリック数が返りません。`,
    });
  }

  if (audience.hiddenExcluded > 0) {
    warnings.push({
      level: 'info',
      message: `非表示にした ${audience.hiddenExcluded} 人は届く人数に入っていません。`,
    });
  }

  if (opts.hasRecentSimilar) {
    warnings.push({
      level: 'warning',
      message: '直近24時間に同じ内容の配信があります。二重に送っていないか確認してください。',
    });
  }

  return warnings;
}

/**
 * 直近に同じ本文の配信があるか。
 *
 * 押し間違いによる二重送信を、送る前に気づけるようにする。
 * 冪等キーは同じリクエストの再送を防ぐが、人が2回作って2回押す場合は
 * 別のリクエストなので通ってしまう。
 */
export async function hasRecentSimilarBroadcast(
  db: D1Database,
  messageContent: string,
  nowIso: string,
): Promise<boolean> {
  const since = new Date(Date.parse(nowIso) - 24 * 3600_000).toISOString();
  const row = await db
    .prepare(
      `SELECT 1 FROM broadcasts
        WHERE message_content = ? AND sent_at IS NOT NULL AND sent_at >= ?
        LIMIT 1`,
    )
    .bind(messageContent, since)
    .first<{ 1: number }>();
  return row != null;
}
