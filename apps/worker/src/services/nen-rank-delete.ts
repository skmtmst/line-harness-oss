import { getNenRankRules, getNenRankSettings, jstNow, type NenRankSetting } from '@line-crm/db';

export class NenRankDeleteError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}

// 会員一覧と同じ優先順位：ECのキー、通年、通年が0なら累計。
const effectiveRank = `COALESCE(
  (SELECT rank_key FROM nen_rank_settings WHERE line_account_id = f.line_account_id AND rank_key = s.member_rank_key),
  (SELECT rank_key FROM nen_rank_settings WHERE line_account_id = f.line_account_id
    AND annual_threshold_yen <= CASE WHEN s.annual_miles_yen <> 0 THEN s.annual_miles_yen ELSE s.lifetime_miles_yen END
    ORDER BY annual_threshold_yen DESC LIMIT 1))`;

export async function countRankMembers(db: D1Database, accountId: string, rankKey: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM nen_ec_member_snapshots s JOIN friends f ON f.id = s.friend_id
    WHERE f.line_account_id = ? AND ${effectiveRank} = ?`).bind(accountId, rankKey).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** 会員・タグ・設定の版・ECへの送信待ちを同じトランザクションで変更する。 */
export async function deleteNenRank(
  db: D1Database, accountId: string, rankId: string, replacementRankId: string | null, expectedVersion: number,
  prepareTags: (ranks: NenRankSetting[], now: string) => Promise<NenRankSetting[]>,
  actor: string,
) {
  const [ranks, rules] = await Promise.all([getNenRankSettings(db, accountId), getNenRankRules(db, accountId)]);
  if (!rules || rules.version !== expectedVersion) throw new NenRankDeleteError('版が変わりました。読み直してから削除してください', 409);
  const source = ranks.find((rank) => rank.id === rankId);
  if (!source) throw new NenRankDeleteError('削除するランクが見つかりません', 404);
  if (source.annual_threshold_yen === 0) throw new NenRankDeleteError('しきい値が0円のランクは削除できません', 409);
  const target = ranks.find((rank) => rank.id === replacementRankId);
  if (replacementRankId && (!target || target.id === source.id)) throw new NenRankDeleteError('移す先は同じアカウントの別のランクを選んでください', 400);
  if (!target && await countRankMembers(db, accountId, source.rank_key) > 0) throw new NenRankDeleteError('会員がいるランクには移す先が必要です', 400);
  const now = jstNow();
  const prepared = await prepareTags(target ? [source, target] : [source], now);
  const sourceTag = prepared[0]!.tag_id;
  const targetTag = prepared[1]?.tag_id;
  // batch内だけの印。失敗した版検査の後続SQLが、他の削除を実行しないようにする。
  const operation = crypto.randomUUID();
  const gate = `EXISTS (SELECT 1 FROM nen_rank_rules WHERE line_account_id = ? AND sync_error = ?)`;
  const members = `SELECT s.friend_id FROM nen_ec_member_snapshots s JOIN friends f ON f.id = s.friend_id
    WHERE f.line_account_id = ? AND ${effectiveRank} = ?`;
  const statements = [db.prepare(`UPDATE nen_rank_rules SET version = version + 1, sync_status = 'pending', sync_error = ?, updated_at = ?
    WHERE line_account_id = ? AND version = ?
      AND (? IS NOT NULL OR NOT EXISTS (${members}))`).bind(operation, now, accountId, expectedVersion, target?.id ?? null, accountId, source.rank_key)];
  if (target && targetTag) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
      SELECT friend_id, ?, ? FROM (${members}) WHERE ${gate}`).bind(targetTag, now, accountId, source.rank_key, accountId, operation));
  }
  if (sourceTag) {
    statements.push(db.prepare(`DELETE FROM friend_tags WHERE tag_id = ? AND friend_id IN
      (SELECT id FROM friends WHERE line_account_id = ?) AND ${gate}`).bind(sourceTag, accountId, accountId, operation));
  }
  const updateIndex = statements.length;
  if (target) {
    statements.push(db.prepare(`INSERT INTO nen_member_rank_sync
      (id, operation_id, line_account_id, friend_id, customer_id, rank_key, actor, reason, created_at, updated_at)
      SELECT 'rank-delete:' || ? || ':' || lower(hex(randomblob(16))), ?, ?, s.friend_id, s.customer_id, ?, ?, ?, ?, ?
      FROM nen_ec_member_snapshots s WHERE s.friend_id IN (${members}) AND ${gate}`)
      .bind(operation, operation, accountId, target.rank_key, actor, 'ランク削除による移し替え', now, now,
        accountId, source.rank_key, accountId, operation));
    statements.push(db.prepare(`UPDATE nen_ec_member_snapshots SET member_rank_key = ?, member_rank = ?, mile_rate_percent = ?
      WHERE friend_id IN (${members}) AND ${gate}`).bind(target.rank_key, target.name, target.mile_rate_percent, accountId, source.rank_key, accountId, operation));
  }
  statements.push(db.prepare(`DELETE FROM nen_rank_settings WHERE id = ? AND line_account_id = ? AND ${gate}`).bind(source.id, accountId, accountId, operation));
  statements.push(db.prepare(`UPDATE nen_rank_rules SET sync_error = NULL WHERE line_account_id = ? AND sync_error = ?`).bind(accountId, operation));
  const result = await db.batch(statements);
  if (Number(result[0]?.meta.changes) !== 1) throw new NenRankDeleteError('版または会員数が変わりました。読み直してから削除してください', 409);
  return {
    id: source.id, replacementRankId: target?.id ?? null,
    movedMembers: target ? Number(result[updateIndex + 1]?.meta.changes ?? 0) : 0,
    version: expectedVersion + 1, ecSync: 'pending' as const, message: '次の同期で反映',
    operationId: operation,
  };
}
