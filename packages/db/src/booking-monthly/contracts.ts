import type { MonthlyContractSnapshot, MonthlyContractRow, MonthlyScope } from './types.js';
import { MonthlyLedgerError } from './types.js';

/** 本人/権限は呼出元で確認する。固定した見積もりとcheckpointを同じbatchへ入れられる口。 */
export function prepareMonthlyContract(db: D1Database, scope: MonthlyScope, input: MonthlyContractSnapshot,
  requestKey: string, now: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO booking_monthly_contracts
    (id,tenant_id,account_id,friend_id,plan_id,plan_version,name,class_kind,class_id,amount,monthly_limit,
     timezone,consent_version,consented_at,connected_account,connection_identity,request_key,request_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(input.id,scope.tenantId,scope.accountId,input.friendId,
      input.planId,input.planVersion,input.name,input.classKind,input.classId,input.amount,input.monthlyLimit,
      input.timezone,input.consentVersion,input.consentedAt,input.connectedAccount,input.connectionIdentity,
      requestKey,contractRequest(input),now,now);
}
export async function getMonthlyContractRow(db: D1Database, scope: MonthlyScope, id: string): Promise<MonthlyContractRow | null> {
  return db.prepare('SELECT * FROM booking_monthly_contracts WHERE id=? AND tenant_id=? AND account_id=?')
    .bind(id,scope.tenantId,scope.accountId).first<MonthlyContractRow>();
}
/** 古いキーと異なる入力を同じ申込に畳まない。別キーの同クラスはactive_slotsで制約される。 */
export async function findMonthlyContractReplay(db: D1Database, scope: MonthlyScope, friendId: string,
  requestKey: string, input: MonthlyContractSnapshot): Promise<MonthlyContractRow | null> {
  const row=await db.prepare(`SELECT * FROM booking_monthly_contracts WHERE tenant_id=? AND account_id=? AND friend_id=? AND request_key=?`)
    .bind(scope.tenantId,scope.accountId,friendId,requestKey).first<MonthlyContractRow>();
  if(row && row.request_json!==contractRequest(input)) throw new MonthlyLedgerError('monthly_idempotency_conflict');
  return row;
}

/** 認可と現在の店/接続は各実行入口で再確認する。更新は全て期待版に限定する。 */
export async function setMonthlyServiceState(db: D1Database, scope: MonthlyScope, id: string, expectedVersion: number,
  state: 'enabled' | 'review_hold', episode: { id: string; startedAt: string } | null, reason: string, now: string): Promise<void> {
  if (!reason.trim()) throw new MonthlyLedgerError('monthly_reason_required',400);
  const result=await db.prepare(`UPDATE booking_monthly_contracts SET service_state=?,attention_episode_id=?,attention_started_at=?,service_reason=?,
    version=version+1,updated_at=? WHERE id=? AND tenant_id=? AND account_id=? AND version=?`)
    .bind(state,episode?.id??null,episode?.startedAt??null,reason.trim(),now,id,scope.tenantId,scope.accountId,expectedVersion).run();
  if(result.meta.changes!==1) throw new MonthlyLedgerError('monthly_version_conflict');
}

function contractRequest(input: MonthlyContractSnapshot): string {
  const { id: _generatedId, ...snapshot } = input;
  return JSON.stringify(snapshot);
}
