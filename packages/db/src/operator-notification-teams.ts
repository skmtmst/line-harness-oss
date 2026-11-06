import type { OperatorNotificationTeam } from '@line-crm/shared';
import { jstNow } from './utils.js';

type TeamRow = { id: string; line_account_id: string; name: string; staff_ids: string; version: number; archived_at: string | null };
const serialize = (r: TeamRow): OperatorNotificationTeam => ({id:r.id,lineAccountId:r.line_account_id,name:r.name,staffIds:JSON.parse(r.staff_ids),version:r.version,archivedAt:r.archived_at});
export async function listOperatorNotificationTeams(db:D1Database,accountId:string) {
  const rows=await db.prepare('SELECT * FROM operator_notification_teams WHERE line_account_id = ? AND archived_at IS NULL ORDER BY name,id').bind(accountId).all<TeamRow>();
  return rows.results.map(serialize);
}
export async function getOperatorNotificationTeam(db:D1Database,id:string,accountId:string) {
  const row=await db.prepare('SELECT * FROM operator_notification_teams WHERE id = ? AND line_account_id = ? AND archived_at IS NULL').bind(id,accountId).first<TeamRow>();
  return row ? serialize(row) : null;
}
export async function eligibleTeamStaffIds(db:D1Database,accountId:string,ids:string[]) {
  const rows=await db.prepare(`SELECT sm.id FROM staff_members sm JOIN line_accounts la ON la.id = ?
    WHERE sm.is_active = 1 AND COALESCE(sm.tenant_id,'default') = COALESCE(la.tenant_id,'default')
    AND (COALESCE(sm.account_scope,'all') = 'all' OR sm.assigned_line_account_id = la.id
      OR EXISTS (SELECT 1 FROM staff_account_scopes sas WHERE sas.staff_id = sm.id AND sas.line_account_id = la.id))
    AND sm.id IN (SELECT value FROM json_each(?))`).bind(accountId,JSON.stringify(ids)).all<{id:string}>();
  return rows.results.map(r=>r.id);
}
export async function saveOperatorNotificationTeam(db:D1Database,input:{id?:string;lineAccountId:string;name:string;staffIds:string[];expectedVersion?:number}) {
  const ids=[...new Set(input.staffIds)];
  if(ids.length === 0 || (await eligibleTeamStaffIds(db,input.lineAccountId,ids)).length !== ids.length) throw new Error('invalid_team_members');
  const id=input.id ?? crypto.randomUUID(); const now=jstNow();
  if(input.id) {
    const result=await db.prepare(`UPDATE operator_notification_teams SET name = ?,staff_ids = ?,version = version + 1,updated_at = ?
      WHERE id = ? AND line_account_id = ? AND archived_at IS NULL AND version = ?`)
      .bind(input.name,JSON.stringify(ids),now,id,input.lineAccountId,input.expectedVersion ?? 0).run();
    if(!result.meta.changes) return null;
  } else {
    await db.prepare(`INSERT INTO operator_notification_teams (id,line_account_id,name,staff_ids,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(id,input.lineAccountId,input.name,JSON.stringify(ids),now,now).run();
  }
  return getOperatorNotificationTeam(db,id,input.lineAccountId);
}
export async function archiveOperatorNotificationTeam(db:D1Database,id:string,accountId:string,version:number) {
  const result=await db.prepare(`UPDATE operator_notification_teams SET archived_at = ?,updated_at = ?,version = version + 1
    WHERE id = ? AND line_account_id = ? AND archived_at IS NULL AND version = ?`).bind(jstNow(),jstNow(),id,accountId,version).run();
  return Boolean(result.meta.changes);
}
/** 消えたチーム・全員退職でも、全スタッフへ宛先を広げない。 */
export async function operatorRuleRecipientIds(db:D1Database,accountId:string,conditions:{teamId?:string;recipientIds?:string[]}) {
  if(conditions.teamId) return (await getOperatorNotificationTeam(db,conditions.teamId,accountId))?.staffIds ?? [];
  return conditions.recipientIds;
}
