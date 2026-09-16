import { jstNow } from './utils.js';

/**
 * 然-NEN- 会員ランク（通年）・ライフタイム・マイル。★V6 37-1（`IqL2Z`）／37-1-A（`p7xHl`）／37-1-B（`Vt65m`）。
 *
 * - ランク：通年（1〜12月の購入額）で決まる。しきい値と還元率はここで持つ（設定の正本はLINE側）。
 * - ライフタイム：累計購入額。減らない。節目の特典は未設定のまま持てる。
 * - マイル：お客様に見せる呼び名。EC内部のポイントと同じもの。画面に「ポイント」は出さない。
 *
 * 計算（通年・ライフタイム・ランク・残高）はEC側で行い、結果を nen_ec_member_snapshots に受け取る。
 * ECの値が無い友だちには、ここの設定と暫定の累計から画面用にランクを求める（`resolveRank`）。
 */

export const NEN_RANK_NAME_MAX = 20;
export const NEN_RANK_RATE_MAX = 10;
export const NEN_RANK_COUNT_MAX = 8;
export const NEN_MILESTONE_COUNT_MAX = 12;

export interface NenRankSetting {
  id: string;
  line_account_id: string;
  rank_key: string;
  name: string;
  annual_threshold_yen: number;
  mile_rate_percent: number;
  tag_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NenRankRules {
  line_account_id: string;
  year_start_month: number;
  apply_on_reach: 'immediate';
  keep_until: 'end_of_next_year';
  count_orders: 'paid_excluding_cancel_refund';
  version: number;
  sync_status: 'pending' | 'synced' | 'failed';
  sync_error: string | null;
  synced_at: string | null;
  updated_at: string;
}

export interface NenLifetimeMilestone {
  id: string;
  line_account_id: string;
  threshold_yen: number;
  title: string;
  benefit_kind: string | null;
  benefit_note: string | null;
  notify_on_reach: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NenRankInput {
  /** 既存行は id を持つ。新しい行は省略。 */
  id?: string | null;
  name: string;
  annualThresholdYen: number;
  mileRatePercent: number;
}

export interface NenMilestoneInput {
  id?: string | null;
  thresholdYen: number;
  title: string;
  notifyOnReach: boolean;
}

/** 初期の4ランク。既存のタグ ID（migration 080）にそのままつなぐ。 */
export const DEFAULT_NEN_RANKS: ReadonlyArray<{ key: string; name: string; thresholdYen: number; ratePercent: number; tagId: string }> = [
  { key: 'regular', name: 'レギュラー', thresholdYen: 0, ratePercent: 1, tagId: 'nen-tag-member-rank-basic' },
  { key: 'silver', name: 'シルバー', thresholdYen: 30_000, ratePercent: 1.5, tagId: 'nen-tag-member-rank-silver' },
  { key: 'gold', name: 'ゴールド', thresholdYen: 60_000, ratePercent: 2, tagId: 'nen-tag-member-rank-gold' },
  { key: 'platinum', name: 'プラチナ', thresholdYen: 120_000, ratePercent: 3, tagId: 'nen-tag-member-rank-platinum' },
];

/** 初期の節目。特典は未設定（Masato の決定 2026-09-16：まず貯まる仕組みだけ）。 */
export const DEFAULT_NEN_MILESTONES: ReadonlyArray<{ thresholdYen: number; title: string }> = [
  { thresholdYen: 300_000, title: 'NEN FAMILY' },
  { thresholdYen: 600_000, title: 'NEN FAMILY＋' },
  { thresholdYen: 1_000_000, title: 'NEN PARTNER' },
  { thresholdYen: 2_000_000, title: 'NEN PARTNER＋' },
];

export class NenRankValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NenRankValidationError';
  }
}

function rankKeyFor(name: string, index: number, existing: Set<string>): string {
  const base = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let key = base || `rank-${index + 1}`;
  let n = 2;
  while (existing.has(key)) key = `${base || `rank-${index + 1}`}-${n++}`;
  existing.add(key);
  return key;
}

/**
 * 設定が無いアカウントに初期値を入れる。何度呼んでも増えない。
 */
export async function ensureNenRankDefaults(db: D1Database, lineAccountId: string, now = jstNow()): Promise<void> {
  const ranks = await db.prepare(`SELECT COUNT(*) AS count FROM nen_rank_settings WHERE line_account_id = ?`)
    .bind(lineAccountId).first<{ count: number }>();
  if (!ranks || Number(ranks.count) === 0) {
    for (const [index, rank] of DEFAULT_NEN_RANKS.entries()) {
      await db.prepare(
        `INSERT INTO nen_rank_settings (id, line_account_id, rank_key, name, annual_threshold_yen, mile_rate_percent, tag_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), lineAccountId, rank.key, rank.name, rank.thresholdYen, rank.ratePercent, rank.tagId, index, now, now).run();
    }
  }
  await db.prepare(
    `INSERT OR IGNORE INTO nen_rank_rules (line_account_id, updated_at) VALUES (?, ?)`,
  ).bind(lineAccountId, now).run();
  const milestones = await db.prepare(`SELECT COUNT(*) AS count FROM nen_lifetime_milestones WHERE line_account_id = ?`)
    .bind(lineAccountId).first<{ count: number }>();
  if (!milestones || Number(milestones.count) === 0) {
    for (const [index, milestone] of DEFAULT_NEN_MILESTONES.entries()) {
      await db.prepare(
        `INSERT INTO nen_lifetime_milestones (id, line_account_id, threshold_yen, title, notify_on_reach, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), lineAccountId, milestone.thresholdYen, milestone.title, index, now, now).run();
    }
  }
}

export async function getNenRankSettings(db: D1Database, lineAccountId: string): Promise<NenRankSetting[]> {
  const rows = await db.prepare(
    `SELECT * FROM nen_rank_settings WHERE line_account_id = ? ORDER BY annual_threshold_yen ASC, sort_order ASC`,
  ).bind(lineAccountId).all<NenRankSetting>();
  return rows.results;
}

export async function getNenRankRules(db: D1Database, lineAccountId: string): Promise<NenRankRules | null> {
  return db.prepare(`SELECT * FROM nen_rank_rules WHERE line_account_id = ?`).bind(lineAccountId).first<NenRankRules>();
}

export async function getNenLifetimeMilestones(db: D1Database, lineAccountId: string): Promise<NenLifetimeMilestone[]> {
  const rows = await db.prepare(
    `SELECT * FROM nen_lifetime_milestones WHERE line_account_id = ? ORDER BY threshold_yen ASC, sort_order ASC`,
  ).bind(lineAccountId).all<NenLifetimeMilestone>();
  return rows.results;
}

/** 保存前の検証。画面と同じ言葉でエラーを返す。 */
export function validateNenRankInputs(inputs: NenRankInput[]): void {
  if (inputs.length === 0) throw new NenRankValidationError('ランクを1つ以上入れてください');
  if (inputs.length > NEN_RANK_COUNT_MAX) throw new NenRankValidationError(`ランクは${NEN_RANK_COUNT_MAX}つまでです`);
  const sorted = [...inputs].sort((a, b) => a.annualThresholdYen - b.annualThresholdYen);
  if (sorted[0]!.annualThresholdYen !== 0) throw new NenRankValidationError('しきい値が0円のランク（レギュラー）が必要です');
  const seenThreshold = new Set<number>();
  const seenName = new Set<string>();
  for (const input of inputs) {
    const name = input.name.trim();
    if (!name) throw new NenRankValidationError('ランク名を入れてください');
    if (name.length > NEN_RANK_NAME_MAX) throw new NenRankValidationError(`ランク名は${NEN_RANK_NAME_MAX}文字までです`);
    if (seenName.has(name)) throw new NenRankValidationError(`ランク名「${name}」が重なっています`);
    seenName.add(name);
    if (!Number.isInteger(input.annualThresholdYen) || input.annualThresholdYen < 0) {
      throw new NenRankValidationError('しきい値は0以上の整数（円）で入れてください');
    }
    if (seenThreshold.has(input.annualThresholdYen)) throw new NenRankValidationError('同じしきい値のランクが2つあります');
    seenThreshold.add(input.annualThresholdYen);
    if (!Number.isFinite(input.mileRatePercent) || input.mileRatePercent < 0 || input.mileRatePercent > NEN_RANK_RATE_MAX) {
      throw new NenRankValidationError(`マイル還元は0〜${NEN_RANK_RATE_MAX}%で入れてください`);
    }
  }
}

export function validateNenMilestoneInputs(inputs: NenMilestoneInput[]): void {
  if (inputs.length > NEN_MILESTONE_COUNT_MAX) throw new NenRankValidationError(`節目は${NEN_MILESTONE_COUNT_MAX}つまでです`);
  const seen = new Set<number>();
  for (const input of inputs) {
    if (!Number.isInteger(input.thresholdYen) || input.thresholdYen <= 0) throw new NenRankValidationError('節目は1円以上の整数で入れてください');
    if (seen.has(input.thresholdYen)) throw new NenRankValidationError('同じ金額の節目が2つあります');
    seen.add(input.thresholdYen);
    const title = input.title.trim();
    if (!title) throw new NenRankValidationError('称号を入れてください');
    if (title.length > 30) throw new NenRankValidationError('称号は30文字までです');
  }
}

/**
 * ランクを一括保存する。渡されなかった既存行は消す。しきい値0の行は残す（削除不可）。
 * 版（version）を +1 し、同期状態を pending に戻す。タグの用意は呼び出し側（Worker）が行う。
 */
export async function saveNenRankSettings(
  db: D1Database,
  lineAccountId: string,
  inputs: NenRankInput[],
  now = jstNow(),
): Promise<NenRankSetting[]> {
  validateNenRankInputs(inputs);
  const existing = await getNenRankSettings(db, lineAccountId);
  const byId = new Map(existing.map((row) => [row.id, row]));
  const keys = new Set(existing.map((row) => row.rank_key));
  const sorted = [...inputs].sort((a, b) => a.annualThresholdYen - b.annualThresholdYen);
  const keepIds = new Set<string>();
  for (const [index, input] of sorted.entries()) {
    const name = input.name.trim();
    const current = input.id ? byId.get(input.id) : undefined;
    if (current) {
      keepIds.add(current.id);
      await db.prepare(
        `UPDATE nen_rank_settings SET name = ?, annual_threshold_yen = ?, mile_rate_percent = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
      ).bind(name, input.annualThresholdYen, input.mileRatePercent, index, now, current.id).run();
    } else {
      const id = crypto.randomUUID();
      keepIds.add(id);
      await db.prepare(
        `INSERT INTO nen_rank_settings (id, line_account_id, rank_key, name, annual_threshold_yen, mile_rate_percent, tag_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).bind(id, lineAccountId, rankKeyFor(name, index, keys), name, input.annualThresholdYen, input.mileRatePercent, index, now, now).run();
    }
  }
  for (const row of existing) {
    if (keepIds.has(row.id)) continue;
    if (row.annual_threshold_yen === 0) continue;
    await db.prepare(`DELETE FROM nen_rank_settings WHERE id = ?`).bind(row.id).run();
  }
  await db.prepare(
    `INSERT INTO nen_rank_rules (line_account_id, version, sync_status, updated_at) VALUES (?, 1, 'pending', ?)
     ON CONFLICT(line_account_id) DO UPDATE SET version = version + 1, sync_status = 'pending', sync_error = NULL, updated_at = excluded.updated_at`,
  ).bind(lineAccountId, now).run();
  return getNenRankSettings(db, lineAccountId);
}

export async function setNenRankTagId(db: D1Database, rankId: string, tagId: string, now = jstNow()): Promise<void> {
  await db.prepare(`UPDATE nen_rank_settings SET tag_id = ?, updated_at = ? WHERE id = ?`).bind(tagId, now, rankId).run();
}

export async function saveNenLifetimeMilestones(
  db: D1Database,
  lineAccountId: string,
  inputs: NenMilestoneInput[],
  now = jstNow(),
): Promise<NenLifetimeMilestone[]> {
  validateNenMilestoneInputs(inputs);
  const existing = await getNenLifetimeMilestones(db, lineAccountId);
  const byId = new Map(existing.map((row) => [row.id, row]));
  const sorted = [...inputs].sort((a, b) => a.thresholdYen - b.thresholdYen);
  const keepIds = new Set<string>();
  for (const [index, input] of sorted.entries()) {
    const current = input.id ? byId.get(input.id) : undefined;
    if (current) {
      keepIds.add(current.id);
      await db.prepare(
        `UPDATE nen_lifetime_milestones SET threshold_yen = ?, title = ?, notify_on_reach = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
      ).bind(input.thresholdYen, input.title.trim(), input.notifyOnReach ? 1 : 0, index, now, current.id).run();
    } else {
      const id = crypto.randomUUID();
      keepIds.add(id);
      await db.prepare(
        `INSERT INTO nen_lifetime_milestones (id, line_account_id, threshold_yen, title, notify_on_reach, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, lineAccountId, input.thresholdYen, input.title.trim(), input.notifyOnReach ? 1 : 0, index, now, now).run();
    }
  }
  for (const row of existing) {
    if (!keepIds.has(row.id)) await db.prepare(`DELETE FROM nen_lifetime_milestones WHERE id = ?`).bind(row.id).run();
  }
  await db.prepare(
    `INSERT INTO nen_rank_rules (line_account_id, version, sync_status, updated_at) VALUES (?, 1, 'pending', ?)
     ON CONFLICT(line_account_id) DO UPDATE SET version = version + 1, sync_status = 'pending', sync_error = NULL, updated_at = excluded.updated_at`,
  ).bind(lineAccountId, now).run();
  return getNenLifetimeMilestones(db, lineAccountId);
}

export async function setNenRankSyncStatus(
  db: D1Database,
  lineAccountId: string,
  status: 'synced' | 'failed',
  error: string | null,
  now = jstNow(),
): Promise<void> {
  await db.prepare(
    `UPDATE nen_rank_rules SET sync_status = ?, sync_error = ?, synced_at = CASE WHEN ? = 'synced' THEN ? ELSE synced_at END, updated_at = ? WHERE line_account_id = ?`,
  ).bind(status, error, status, now, now, lineAccountId).run();
}

/**
 * 通年の金額から、いまのランクを求める（しきい値以上の最上位）。
 * ECから `member_rank_key` が届いているときはそちらを優先する。
 */
export function resolveRank(
  ranks: ReadonlyArray<Pick<NenRankSetting, 'rank_key' | 'name' | 'annual_threshold_yen' | 'mile_rate_percent' | 'tag_id'>>,
  annualYen: number,
  preferredKey?: string | null,
): { rank: (typeof ranks)[number] | null; next: (typeof ranks)[number] | null } {
  if (ranks.length === 0) return { rank: null, next: null };
  const sorted = [...ranks].sort((a, b) => a.annual_threshold_yen - b.annual_threshold_yen);
  let index = -1;
  if (preferredKey) index = sorted.findIndex((rank) => rank.rank_key === preferredKey);
  if (index < 0) {
    index = 0;
    sorted.forEach((rank, i) => { if (annualYen >= rank.annual_threshold_yen) index = i; });
  }
  return { rank: sorted[index] ?? null, next: sorted[index + 1] ?? null };
}

export interface NenMemberListRow {
  friend_id: string;
  line_account_id: string | null;
  display_name: string | null;
  picture_url: string | null;
  customer_id: string | null;
  member_rank: string;
  member_rank_key: string | null;
  mile_rate_percent: number | null;
  annual_miles_yen: number;
  lifetime_miles_yen: number;
  mile_balance: number;
  rank_valid_until: string | null;
  last_purchased_at: string | null;
  purchase_count: number;
  pet_count: number;
  pet_names: string | null;
  synced_at: string;
}

export interface NenMemberListOptions {
  /** 見える line_account_id。null は未割り当て。 */
  accountIds: Array<string | null>;
  rankKey?: string | null;
  petFilter?: 'any' | 'with' | 'without';
  query?: string;
  sort?: 'annual_desc' | 'lifetime_desc' | 'balance_desc' | 'recent';
  page?: number;
  pageSize?: number;
}

function accountWhere(accountIds: Array<string | null>, column: string): { sql: string; binds: string[] } {
  const ids = accountIds.filter((id): id is string => id !== null);
  const allowNull = accountIds.includes(null);
  if (ids.length === 0 && !allowNull) return { sql: '1 = 0', binds: [] };
  const parts: string[] = [];
  if (ids.length) parts.push(`${column} IN (${ids.map(() => '?').join(',')})`);
  if (allowNull) parts.push(`${column} IS NULL`);
  return { sql: `(${parts.join(' OR ')})`, binds: ids };
}

export async function listNenMembers(
  db: D1Database,
  options: NenMemberListOptions,
): Promise<{ items: NenMemberListRow[]; total: number }> {
  const scope = accountWhere(options.accountIds, 'f.line_account_id');
  const where: string[] = [scope.sql, 'f.is_following = 1'];
  const binds: unknown[] = [...scope.binds];
  if (options.rankKey) {
    where.push('s.member_rank_key = ?');
    binds.push(options.rankKey);
  }
  if (options.petFilter === 'with') where.push('EXISTS (SELECT 1 FROM nen_pet_profiles p WHERE p.friend_id = f.id)');
  if (options.petFilter === 'without') where.push('NOT EXISTS (SELECT 1 FROM nen_pet_profiles p WHERE p.friend_id = f.id)');
  const query = options.query?.trim();
  if (query) {
    where.push('(f.display_name LIKE ? OR s.customer_id LIKE ?)');
    const like = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    binds.push(like, like);
  }
  const order = options.sort === 'lifetime_desc'
    ? 's.lifetime_miles_yen DESC, s.annual_miles_yen DESC'
    : options.sort === 'balance_desc'
      ? 's.mile_balance DESC, s.annual_miles_yen DESC'
      : options.sort === 'recent'
        ? 's.last_purchased_at DESC'
        : 's.annual_miles_yen DESC, s.lifetime_miles_yen DESC';
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 20, 100));
  const page = Math.max(1, options.page ?? 1);
  const base = `FROM nen_ec_member_snapshots s
     JOIN friends f ON f.id = s.friend_id
    WHERE ${where.join(' AND ')}`;
  const total = await db.prepare(`SELECT COUNT(*) AS count ${base}`).bind(...binds).first<{ count: number }>();
  const rows = await db.prepare(
    `SELECT s.friend_id, f.line_account_id, f.display_name, f.picture_url, s.customer_id, s.member_rank, s.member_rank_key,
            s.mile_rate_percent, s.annual_miles_yen, s.lifetime_miles_yen, s.mile_balance, s.rank_valid_until,
            s.last_purchased_at, s.purchase_count, s.synced_at,
            (SELECT COUNT(*) FROM nen_pet_profiles p WHERE p.friend_id = f.id) AS pet_count,
            (SELECT GROUP_CONCAT(p.name || '（' || CASE p.animal_type WHEN 'cat' THEN '猫' WHEN 'dog' THEN '犬' ELSE 'その他' END || '）', '、')
               FROM (SELECT name, animal_type FROM nen_pet_profiles WHERE friend_id = f.id ORDER BY created_at LIMIT 2) p) AS pet_names
     ${base}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
  ).bind(...binds, pageSize, (page - 1) * pageSize).all<NenMemberListRow>();
  return { items: rows.results, total: Number(total?.count ?? 0) };
}

export interface NenMemberKpis {
  members: number;
  annualTotalYen: number;
  lifetimeTotalYen: number;
  balanceTotal: number;
  usedThisMonth: number;
  byRank: Record<string, number>;
}

export async function getNenMemberKpis(db: D1Database, accountIds: Array<string | null>): Promise<NenMemberKpis> {
  const scope = accountWhere(accountIds, 'f.line_account_id');
  const totals = await db.prepare(
    `SELECT COUNT(*) AS members,
            COALESCE(SUM(s.annual_miles_yen), 0) AS annual_total,
            COALESCE(SUM(s.lifetime_miles_yen), 0) AS lifetime_total,
            COALESCE(SUM(s.mile_balance), 0) AS balance_total,
            COALESCE(SUM(s.miles_used_this_month), 0) AS used_this_month
       FROM nen_ec_member_snapshots s JOIN friends f ON f.id = s.friend_id
      WHERE ${scope.sql} AND f.is_following = 1`,
  ).bind(...scope.binds).first<{ members: number; annual_total: number; lifetime_total: number; balance_total: number; used_this_month: number }>();
  const ranks = await db.prepare(
    `SELECT COALESCE(s.member_rank_key, '') AS rank_key, COUNT(*) AS count
       FROM nen_ec_member_snapshots s JOIN friends f ON f.id = s.friend_id
      WHERE ${scope.sql} AND f.is_following = 1
      GROUP BY COALESCE(s.member_rank_key, '')`,
  ).bind(...scope.binds).all<{ rank_key: string; count: number }>();
  const byRank: Record<string, number> = {};
  for (const row of ranks.results) byRank[row.rank_key] = Number(row.count);
  return {
    members: Number(totals?.members ?? 0),
    annualTotalYen: Number(totals?.annual_total ?? 0),
    lifetimeTotalYen: Number(totals?.lifetime_total ?? 0),
    balanceTotal: Number(totals?.balance_total ?? 0),
    usedThisMonth: Number(totals?.used_this_month ?? 0),
    byRank,
  };
}

/** 節目ごとの到達人数（ライフタイムがしきい値以上の友だち）。 */
export async function countNenMilestoneReached(
  db: D1Database,
  accountIds: Array<string | null>,
  thresholds: number[],
): Promise<Record<number, number>> {
  const scope = accountWhere(accountIds, 'f.line_account_id');
  const result: Record<number, number> = {};
  for (const threshold of thresholds) {
    const row = await db.prepare(
      `SELECT COUNT(*) AS count FROM nen_ec_member_snapshots s JOIN friends f ON f.id = s.friend_id
        WHERE ${scope.sql} AND f.is_following = 1 AND s.lifetime_miles_yen >= ?`,
    ).bind(...scope.binds, threshold).first<{ count: number }>();
    result[threshold] = Number(row?.count ?? 0);
  }
  return result;
}
