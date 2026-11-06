import { getMediaUsageMatchTokens } from '@line-crm/db';

export type DirectMediaUsage = { refKind: 'auto_reply' | 'visit_stamp_card'; refId: string; name: string; href: string };

/** 台帳の種別を増やさず、対象アカウントの現在の使用先を直接確かめる。 */
export async function findDirectMediaUsages(db: D1Database, media: { id: string; r2_key: string }, accountId: string): Promise<DirectMediaUsage[]> {
  const tokens = JSON.stringify([...new Set([media.r2_key, ...await getMediaUsageMatchTokens(db, media.id)])].filter(Boolean));
  const replies = await db.prepare(`SELECT ar.id, COALESCE(NULLIF(ar.name,''), ar.keyword) AS name FROM auto_replies ar
    WHERE (ar.line_account_id IS NULL OR ar.line_account_id = ?) AND ar.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(ar.response_content, token.value) > 0 OR instr(COALESCE(ar.actions_json,''), token.value) > 0)
      OR EXISTS (SELECT 1 FROM auto_reply_versions v WHERE v.auto_reply_id = ar.id AND (v.line_account_id IS NULL OR v.line_account_id = ar.line_account_id)
        AND EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(v.definition_snapshot, token.value) > 0)))
    ORDER BY ar.id`).bind(accountId, tokens, tokens).all<{id:string;name:string}>();
  const stamps = await db.prepare(`SELECT c.id, c.name FROM visit_stamp_card_accounts ca
    JOIN visit_stamp_cards c ON c.id=ca.card_id WHERE ca.line_account_id = ?
      AND EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(c.settings_json, token.value) > 0)
    ORDER BY c.id`).bind(accountId, tokens).all<{id:string;name:string}>();
  return [
    ...replies.results.map(row => ({ refKind:'auto_reply' as const, refId:row.id, name:row.name, href:`/auto-replies/edit?id=${encodeURIComponent(row.id)}` })),
    ...stamps.results.map(row => ({ refKind:'visit_stamp_card' as const, refId:row.id, name:row.name, href:'/visit-stamps' })),
  ];
}
