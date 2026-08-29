import { jstNow, toJstString } from './utils.js';
// スコアリング（Lead Scoring）クエリヘルパー

export interface ScoringRuleRow {
  id: string;
  name: string;
  event_type: string;
  score_value: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface FriendScoreRow {
  id: string;
  friend_id: string;
  scoring_rule_id: string | null;
  score_change: number;
  reason: string | null;
  created_at: string;
}

export type ActionScoreBand = 'high' | 'normal' | 'low';
export type ActionScoreFilter = 'all' | ActionScoreBand | 'decreased';
export type ActionScoreSort = 'score_desc' | 'score_asc' | 'change_desc' | 'change_asc' | 'recent_desc';

export interface ActionScoreOverview {
  summary: {
    scoredFriends: number;
    high: number;
    normal: number;
    low: number;
    decreased30d: number;
    highMin: number;
    normalMin: number;
  };
  items: Array<{
    friendId: string;
    displayName: string;
    pictureUrl: string | null;
    currentScore: number;
    band: ActionScoreBand;
    change30d: number;
    lastReason: string | null;
    lastChangedAt: string | null;
  }>;
  pagination: { total: number; limit: number; offset: number };
}

type ActionScoreOverviewRow = {
  friend_id: string;
  display_name: string | null;
  picture_url: string | null;
  current_score: number;
  change_30d: number;
  last_reason: string | null;
  last_rule_name: string | null;
  last_changed_at: string | null;
};

/**
 * V6の「行動スコア」一覧を、既存の friends.score と friend_scores から組み立てる。
 *
 * スコアはLINEアカウントをまたいで合算しない。`accountId` は必須で、Worker
 * 側の権限確認を通った値だけを受け取る。30日変化は履歴から計算し、現在値を
 * 過去へ逆算して作り直さない。
 */
export async function getActionScoreOverview(
  db: D1Database,
  input: {
    accountId: string;
    search?: string;
    filter?: ActionScoreFilter;
    sort?: ActionScoreSort;
    limit?: number;
    offset?: number;
    highMin?: number;
    normalMin?: number;
    now?: string;
  },
): Promise<ActionScoreOverview> {
  const highMin = input.highMin ?? 70;
  const normalMin = input.normalMin ?? 30;
  if (!Number.isInteger(highMin) || !Number.isInteger(normalMin) || normalMin < 0 || highMin <= normalMin) {
    throw new Error('Invalid action score band boundaries');
  }
  const limit = Math.min(100, Math.max(1, input.limit ?? 20));
  const offset = Math.max(0, input.offset ?? 0);
  const filter = input.filter ?? 'all';
  const sort = input.sort ?? 'score_desc';
  const search = input.search?.trim() ?? '';
  const now = input.now ? new Date(input.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Invalid action score reference time');
  const since30d = toJstString(new Date(now.getTime() - 30 * 24 * 60 * 60_000));

  const summary = await db.prepare(
    `WITH recent AS (
       SELECT fs.friend_id, SUM(fs.score_change) AS change_30d
         FROM friend_scores fs
         JOIN friends scoped_friend ON scoped_friend.id = fs.friend_id
        WHERE scoped_friend.line_account_id = ? AND fs.created_at >= ?
        GROUP BY fs.friend_id
     )
     SELECT COUNT(*) AS scored_friends,
            SUM(CASE WHEN f.score >= ? THEN 1 ELSE 0 END) AS high_count,
            SUM(CASE WHEN f.score >= ? AND f.score < ? THEN 1 ELSE 0 END) AS normal_count,
            SUM(CASE WHEN f.score < ? THEN 1 ELSE 0 END) AS low_count,
            SUM(CASE WHEN COALESCE(recent.change_30d, 0) < 0 THEN 1 ELSE 0 END) AS decreased_30d
       FROM friends f
       LEFT JOIN recent ON recent.friend_id = f.id
      WHERE f.line_account_id = ?
        AND (f.score != 0 OR EXISTS (SELECT 1 FROM friend_scores any_score WHERE any_score.friend_id = f.id))`,
  ).bind(
    input.accountId,
    since30d,
    highMin,
    normalMin,
    highMin,
    normalMin,
    input.accountId,
  ).first<{
    scored_friends: number;
    high_count: number;
    normal_count: number;
    low_count: number;
    decreased_30d: number;
  }>();

  const conditions = [
    'f.line_account_id = ?',
    '(f.score != 0 OR EXISTS (SELECT 1 FROM friend_scores any_score WHERE any_score.friend_id = f.id))',
  ];
  const conditionBindings: unknown[] = [input.accountId];
  if (search) {
    conditions.push('f.display_name LIKE ?');
    conditionBindings.push(`%${search}%`);
  }
  if (filter === 'high') {
    conditions.push('f.score >= ?');
    conditionBindings.push(highMin);
  } else if (filter === 'normal') {
    conditions.push('f.score >= ? AND f.score < ?');
    conditionBindings.push(normalMin, highMin);
  } else if (filter === 'low') {
    conditions.push('f.score < ?');
    conditionBindings.push(normalMin);
  } else if (filter === 'decreased') {
    conditions.push('COALESCE(recent.change_30d, 0) < 0');
  }
  const where = conditions.join(' AND ');
  const orderBy: Record<ActionScoreSort, string> = {
    score_desc: 'f.score DESC, f.updated_at DESC, f.id ASC',
    score_asc: 'f.score ASC, f.updated_at DESC, f.id ASC',
    change_desc: 'COALESCE(recent.change_30d, 0) DESC, f.score DESC, f.id ASC',
    change_asc: 'COALESCE(recent.change_30d, 0) ASC, f.score DESC, f.id ASC',
    recent_desc: 'latest.last_changed_at DESC, f.score DESC, f.id ASC',
  };
  const recentCte = `recent AS (
    SELECT fs.friend_id, SUM(fs.score_change) AS change_30d
      FROM friend_scores fs
      JOIN friends scoped_friend ON scoped_friend.id = fs.friend_id
     WHERE scoped_friend.line_account_id = ? AND fs.created_at >= ?
     GROUP BY fs.friend_id
  )`;

  const totalRow = await db.prepare(
    `WITH ${recentCte}
     SELECT COUNT(*) AS total
       FROM friends f
       LEFT JOIN recent ON recent.friend_id = f.id
      WHERE ${where}`,
  ).bind(input.accountId, since30d, ...conditionBindings).first<{ total: number }>();

  const result = await db.prepare(
    `WITH ${recentCte},
     latest AS (
       SELECT friend_id, reason, rule_name, created_at AS last_changed_at
         FROM (
           SELECT fs.friend_id, fs.reason, sr.name AS rule_name, fs.created_at, fs.id,
                  ROW_NUMBER() OVER (PARTITION BY fs.friend_id ORDER BY fs.created_at DESC, fs.id DESC) AS rn
             FROM friend_scores fs
             JOIN friends scoped_friend ON scoped_friend.id = fs.friend_id
             LEFT JOIN scoring_rules sr ON sr.id = fs.scoring_rule_id
            WHERE scoped_friend.line_account_id = ?
         )
        WHERE rn = 1
     )
     SELECT f.id AS friend_id,
            f.display_name,
            f.picture_url,
            f.score AS current_score,
            COALESCE(recent.change_30d, 0) AS change_30d,
            latest.reason AS last_reason,
            latest.rule_name AS last_rule_name,
            latest.last_changed_at
       FROM friends f
       LEFT JOIN recent ON recent.friend_id = f.id
       LEFT JOIN latest ON latest.friend_id = f.id
      WHERE ${where}
      ORDER BY ${orderBy[sort]}
      LIMIT ? OFFSET ?`,
  ).bind(
    input.accountId,
    since30d,
    input.accountId,
    ...conditionBindings,
    limit,
    offset,
  ).all<ActionScoreOverviewRow>();

  const items = result.results.map((row) => ({
    friendId: row.friend_id,
    displayName: row.display_name || '名前未設定',
    pictureUrl: row.picture_url,
    currentScore: row.current_score,
    band: row.current_score >= highMin ? 'high' as const : row.current_score >= normalMin ? 'normal' as const : 'low' as const,
    change30d: row.change_30d,
    lastReason: row.last_rule_name || row.last_reason,
    lastChangedAt: row.last_changed_at,
  }));

  return {
    summary: {
      scoredFriends: summary?.scored_friends ?? 0,
      high: summary?.high_count ?? 0,
      normal: summary?.normal_count ?? 0,
      low: summary?.low_count ?? 0,
      decreased30d: summary?.decreased_30d ?? 0,
      highMin,
      normalMin,
    },
    items,
    pagination: { total: totalRow?.total ?? 0, limit, offset },
  };
}

// --- スコアリングルール ---

export async function getScoringRules(db: D1Database): Promise<ScoringRuleRow[]> {
  const result = await db.prepare(`SELECT * FROM scoring_rules ORDER BY created_at DESC`).all<ScoringRuleRow>();
  return result.results;
}

export async function getScoringRuleById(db: D1Database, id: string): Promise<ScoringRuleRow | null> {
  return db.prepare(`SELECT * FROM scoring_rules WHERE id = ?`).bind(id).first<ScoringRuleRow>();
}

export async function createScoringRule(
  db: D1Database,
  input: { name: string; eventType: string; scoreValue: number },
): Promise<ScoringRuleRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO scoring_rules (id, name, event_type, score_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.eventType, input.scoreValue, now, now).run();
  return (await getScoringRuleById(db, id))!;
}

export async function updateScoringRule(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; eventType: string; scoreValue: number; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.scoreValue !== undefined) { sets.push('score_value = ?'); values.push(updates.scoreValue); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE scoring_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteScoringRule(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM scoring_rules WHERE id = ?`).bind(id).run();
}

// --- スコア記録 ---

/** スコアイベントを記録し、friendsテーブルのスコアキャッシュを更新 */
export async function addScore(
  db: D1Database,
  input: { friendId: string; scoringRuleId?: string; scoreChange: number; reason?: string },
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO friend_scores (id, friend_id, scoring_rule_id, score_change, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.friendId, input.scoringRuleId ?? null, input.scoreChange, input.reason ?? null, now).run();

  // スコアキャッシュを更新
  await db.prepare(`UPDATE friends SET score = score + ?, updated_at = ? WHERE id = ?`)
    .bind(input.scoreChange, now, input.friendId).run();
}

/** 友だちの現在スコアを取得 */
export async function getFriendScore(db: D1Database, friendId: string): Promise<number> {
  const row = await db.prepare(`SELECT score FROM friends WHERE id = ?`).bind(friendId).first<{ score: number }>();
  return row?.score ?? 0;
}

/** 友だちのスコア履歴を取得 */
export async function getFriendScoreHistory(db: D1Database, friendId: string): Promise<FriendScoreRow[]> {
  const result = await db.prepare(`SELECT * FROM friend_scores WHERE friend_id = ? ORDER BY created_at DESC`)
    .bind(friendId).all<FriendScoreRow>();
  return result.results;
}

/** イベントタイプに一致するアクティブなスコアリングルールを取得 */
export async function getActiveRulesByEvent(db: D1Database, eventType: string): Promise<ScoringRuleRow[]> {
  const result = await db.prepare(`SELECT * FROM scoring_rules WHERE event_type = ? AND is_active = 1`)
    .bind(eventType).all<ScoringRuleRow>();
  return result.results;
}

/** イベント発生時にスコアリングルールを適用 */
export async function applyScoring(db: D1Database, friendId: string, eventType: string): Promise<number> {
  const rules = await getActiveRulesByEvent(db, eventType);
  let totalChange = 0;
  for (const rule of rules) {
    await addScore(db, {
      friendId,
      scoringRuleId: rule.id,
      scoreChange: rule.score_value,
      reason: `${eventType} → ${rule.name}`,
    });
    totalChange += rule.score_value;
  }
  return totalChange;
}
