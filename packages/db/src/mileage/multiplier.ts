import type { MileageMultiplier } from './types.js';

export async function resolveRankMileageMultiplier(db:D1Database,friendId:string,occurredAt:string){
  const rank=await db.prepare(`SELECT t.mile_multiplier,t.tag_id,t.name FROM member_ranks r JOIN friends f ON f.id=r.friend_id AND f.line_account_id=r.account_id JOIN member_rank_tiers t ON t.id=r.tier_id AND t.account_id=r.account_id JOIN member_rank_programs p ON p.account_id=r.account_id AND p.status='active' WHERE r.friend_id=? AND julianday(r.since)<=julianday(?)`).bind(friendId,occurredAt).first<{mile_multiplier:number;tag_id:string;name:string}>();
  return rank;
}

export async function resolveMileageMultiplier(
  db: D1Database,
  friendId: string,
  occurredAt: string,
): Promise<MileageMultiplier> {
  const row = await db
    .prepare(
      `WITH identity AS (SELECT user_id FROM friends WHERE id = ?)
       SELECT t.mileage_multiplier_bps AS bps, t.id AS tag_id, t.name AS tag_name
         FROM friend_tags ft
         JOIN friends f ON f.id = ft.friend_id
         JOIN tags t ON t.id = ft.tag_id
         LEFT JOIN identity i ON 1 = 1
        WHERE t.mileage_multiplier_bps IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM member_rank_tiers rt WHERE rt.tag_id=t.id)
          AND ft.assigned_at <= ?
          AND (f.id = ? OR (i.user_id IS NOT NULL AND f.user_id = i.user_id))
        ORDER BY t.mileage_multiplier_priority DESC, ft.assigned_at DESC, t.id ASC
        LIMIT 1`,
    )
    .bind(friendId, occurredAt, friendId)
    .first<{ bps: number; tag_id: string; tag_name: string }>();
  const rank=await resolveRankMileageMultiplier(db,friendId,occurredAt);
  if(rank&&Math.round(rank.mile_multiplier*10000)>Number(row?.bps??10000))return {bps:Math.round(rank.mile_multiplier*10000),tagId:rank.tag_id,tagName:rank.name};
  return row
    ? { bps: Number(row.bps), tagId: row.tag_id, tagName: row.tag_name }
    : { bps: 10000, tagId: null, tagName: null };
}
