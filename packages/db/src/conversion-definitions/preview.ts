import { exclusionWhere, readConversionExclusion } from '../conversion-exclusions.js';
import { type PreviewConversionDefinitionInput, type ConversionDefinitionRange } from './types.js';
import { accountWhere } from './reads.js';


/**
 * window方式の「数える」回数を、記録時と同じ規則で過去データへあてはめる。
 *
 * trackConversion の窓は「直近 windowDays 以内に記録済みがあれば書かない」。
 * 試算では過去の成果列を時系列に読み、最後に数えた時刻から
 * windowDays 経ったものだけを数える(先に数えたものが基準になる
 * greedy方式。前の生イベントではなく前の「数えた」イベントとの差で決まる)。
 */
export function estimateWindowDedupCount(
  rows: ReadonlyArray<{ friend_id: string; created_at: string }>,
  windowDays: number,
): number {
  const windowMs = windowDays * 86_400_000;
  const lastCounted = new Map<string, number>();
  let count = 0;
  for (const row of rows) {
    const at = new Date(`${row.created_at.replace(' ', 'T')}+09:00`).getTime();
    if (Number.isNaN(at)) continue;
    const last = lastCounted.get(row.friend_id);
    if (last === undefined || at - last > windowMs) {
      lastCounted.set(row.friend_id, at);
      count += 1;
    }
  }
  return count;
}

/**
 * 取消の試算(N-257)。reversalPolicy = source_cancelled のときだけ、
 * 同じ起点条件の過去成果に対する取消台帳の件数を数える。
 * 台帳(affiliate_adjustments 系)が無い環境では 0 を返す。
 */
export async function estimateCancellationCount(
  db: D1Database,
  conditionsSql: string,
  conditionValues: unknown[],
  from: string,
  to: string,
): Promise<number> {
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('affiliate_adjustments','affiliate_reward_entries')")
    .all<{ name: string }>();
  if (tables.results.length < 2) return 0;
  const row = await db.prepare(`SELECT COUNT(*) AS total
    FROM affiliate_adjustments aa
    JOIN affiliate_reward_entries re ON re.id = aa.source_entry_id
    JOIN conversion_events ce ON ce.id = re.conversion_event_id
    JOIN conversion_points cp ON cp.id = ce.conversion_point_id
    WHERE aa.reason_type = 'cancel'
      AND substr(aa.created_at, 1, 10) >= ? AND substr(aa.created_at, 1, 10) <= ?
      AND ${conditionsSql}`)
    .bind(from.slice(0, 10), to.slice(0, 10), ...conditionValues)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function previewConversionDefinition(
  db: D1Database,
  input: PreviewConversionDefinitionInput,
) {
  const account = accountWhere('cp.', input.scope, input.lineAccountId);
  /*
   * N-257: 試算は「保存したときと同じ条件」で数える。
   *
   * 直す前は起点種別・期間・アカウントだけを見ていたため、url_reach の
   * 対象URLや窓つき重複除外を変えても同じ数字が返っていた。
   * - url_reach: 同じ対象URLを見ていた地点の成果だけを数える。
   * - それ以外の起点: 対象URLを持たない地点の成果だけを数える
   *   (URL条件のある地点の成果を混ぜない)。
   */
  // N-269: 暦日は先頭10文字で比較する(ISOの'T'が空白より大きく、
  // 文字列の大小比較だと期間末の行が抜けるため)。
  const conditions = [`cp.event_type = ?`, `substr(ce.created_at, 1, 10) >= ?`, `substr(ce.created_at, 1, 10) <= ?`];
  const values: unknown[] = [input.sourceType, input.range.from.slice(0, 10), input.range.to.slice(0, 10)];
  if (input.measureMethod === 'url_reach' || input.targetUrl) {
    conditions.push(`cp.target_url = ?`);
    values.push(input.targetUrl ?? '');
  } else {
    conditions.push(`(cp.target_url IS NULL OR cp.target_url = '')`);
  }
  conditions.push(account.sql);
  values.push(...account.values);
  /*
   * R40: 「数えない条件」は試算の過去集計にも効かせる。友だちの条件は
   * friends を `f` で繋いで評価する(segment 条件の組み立てと同じ別名)。
   * 壊れた条件は全件のままにし、理由だけ返す(記録側と同じ倒し方)。
   */
  const exclusion = readConversionExclusion(input.sourceConfig ?? null);
  const exclusionSql = exclusion.condition ? exclusionWhere(exclusion.condition) : null;
  const baseWhere = conditions.join(' AND ');
  const baseValues = [...values];
  if (exclusionSql) {
    conditions.push(exclusionSql.sql);
    values.push(...exclusionSql.bindings);
  }
  const joinFriends = exclusionSql ? 'JOIN friends f ON f.id = ce.friend_id' : '';
  const where = conditions.join(' AND ');

  const row = await db.prepare(`SELECT COUNT(ce.id) AS matched_count,
      COUNT(DISTINCT ce.friend_id) AS unique_friends,
      COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS source_value,
      COUNT(ce.value_snapshot) AS valued_count
    FROM conversion_events ce
    JOIN conversion_points cp ON cp.id = ce.conversion_point_id
    ${joinFriends}
    WHERE ${where}`)
    .bind(...values)
    .first<{ matched_count: number; unique_friends: number; source_value: number; valued_count: number }>();
  const matchedCount = Number(row?.matched_count ?? 0);
  const uniqueFriends = Number(row?.unique_friends ?? 0);
  // R42: 金額の平均は金額のある成果だけで割る。金額なしの行を分母に
  // 入れると、注文金額を使う設定の試算が小さく見える。
  const valuedCount = Number(row?.valued_count ?? 0);
  const missingValueCount = Math.max(0, matchedCount - valuedCount);

  // R40: 除外で除いた過去の件数。試算の数字から消えている分を見せる。
  let excludedPastCount = 0;
  if (exclusionSql && exclusion.condition) {
    const positive = exclusionWhere(exclusion.condition, { negate: false });
    const excludedRow = await db.prepare(`SELECT COUNT(ce.id) AS excluded_count
      FROM conversion_events ce
      JOIN conversion_points cp ON cp.id = ce.conversion_point_id
      JOIN friends f ON f.id = ce.friend_id
      WHERE ${baseWhere}
        AND ${positive.sql}`)
      .bind(...baseValues, ...positive.bindings)
      .first<{ excluded_count: number }>();
    excludedPastCount = Number(excludedRow?.excluded_count ?? 0);
  }

  let estimatedCount: number;
  if (input.deduplicationMode === 'every') {
    estimatedCount = matchedCount;
  } else if (input.deduplicationMode === 'window'
    && Number.isInteger(input.deduplicationWindowDays)
    && (input.deduplicationWindowDays as number) >= 1) {
    // 窓つきは「友だちごと」のまとめではなく時系列が要るので生の行を読む。
    const rows = await db.prepare(`SELECT ce.friend_id, ce.created_at
      FROM conversion_events ce
      JOIN conversion_points cp ON cp.id = ce.conversion_point_id
      ${joinFriends}
      WHERE ${where}
      ORDER BY ce.friend_id ASC, ce.created_at ASC, ce.id ASC`)
      .bind(...values)
      .all<{ friend_id: string; created_at: string }>();
    estimatedCount = estimateWindowDedupCount(rows.results, input.deduplicationWindowDays as number);
  } else {
    estimatedCount = uniqueFriends;
  }

  const cancellationCount = input.reversalPolicy === 'source_cancelled'
    ? await estimateCancellationCount(
        db,
        `cp.event_type = ? AND ${input.measureMethod === 'url_reach' || input.targetUrl ? `cp.target_url = ?` : `(cp.target_url IS NULL OR cp.target_url = '')`} AND ${account.sql}`,
        input.measureMethod === 'url_reach' || input.targetUrl
          ? [input.sourceType, input.targetUrl ?? '', ...account.values]
          : [input.sourceType, ...account.values],
        input.range.from,
        input.range.to,
      )
    : 0;

  const excludedReasons: string[] = [];
  if (matchedCount === 0) excludedReasons.push('選んだ起点の過去データがありません');
  // R40: 数えない条件は試算にも効く。効き方を隠さず画面へ返す。
  if (exclusion.invalid) {
    excludedReasons.push('「数えない条件」が読み取れないため、試算では全件を対象にしています');
  } else if (exclusion.condition) {
    if (excludedPastCount > 0) {
      excludedReasons.push(`「数えない条件」に当てはまる過去の成果${excludedPastCount}件を除いています`);
    } else if (matchedCount > 0) {
      excludedReasons.push('「数えない条件」に当てはまる過去の成果はありませんでした');
    }
  } else if (exclusion.legacyMemoMigrated) {
    excludedReasons.push('以前の「数えない条件」のメモは記録に影響しません。条件として効かせるには選び直してください');
  }
  // R42: 金額なしの成果があるときは、試算の金額が金額のある成果だけの
  // 平均であることを隠さない。
  if (missingValueCount > 0 && input.valueMode === 'source') {
    excludedReasons.push(`金額のない過去の成果${missingValueCount}件は金額の試算に入っていません`);
  }

  const sourceAverage = valuedCount > 0 ? Number(row?.source_value ?? 0) / valuedCount : 0;
  const unitValue = input.valueMode === 'fixed'
    ? Number(input.fixedValue ?? 0)
    : input.valueMode === 'source' ? sourceAverage : 0;
  return {
    range: input.range,
    matchedCount,
    uniqueFriendCount: uniqueFriends,
    excludedCount: excludedPastCount,
    estimatedCount,
    estimatedValue: Math.round(estimatedCount * unitValue),
    duplicateExcludedCount: Math.max(0, matchedCount - estimatedCount),
    cancellationCount,
    excludedReasons,
    missingValueCount,
    dailyAverage: Math.round((estimatedCount / 30) * 10) / 10,
    deduplicationWindowDays: input.deduplicationMode === 'window'
      ? input.deduplicationWindowDays ?? null : null,
  };
}
