import type { MonthlyScope } from './types.js';
import { MonthlyLedgerError } from './types.js';

export interface MonthlyEventApplication {
  source: string; connectedAccount: string; eventId: string; receiptId: string; payloadDigest: string;
  contractId: string; cycleId: string | null;
  outcome: 'setup_ready' | 'paid' | 'failed' | 'processing' | 'void' | 'ignored';
}
/** 署名と接続先を検証済みの共通受信への適用先だけを、権利等の変更と同じbatchに保存する。 */
export function prepareMonthlyEventApplication(db: D1Database, scope: MonthlyScope, input: MonthlyEventApplication, at: string): D1PreparedStatement[] {
  const identity=[input.source,input.connectedAccount,input.eventId];
  return [db.prepare(`SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM booking_monthly_event_applications WHERE source=? AND connected_account=? AND provider_event_id=?)
    OR EXISTS(SELECT 1 FROM booking_monthly_event_applications WHERE source=? AND connected_account=? AND provider_event_id=?
      AND tenant_id=? AND account_id=? AND contract_id=? AND cycle_id IS ? AND payload_digest=? AND receipt_id=? AND outcome=?)
    THEN 'true' ELSE 'monthly_event_conflict' END)`).bind(...identity,...identity,scope.tenantId,scope.accountId,input.contractId,
      input.cycleId,input.payloadDigest,input.receiptId,input.outcome),
  db.prepare(`INSERT INTO booking_monthly_event_applications(source,connected_account,provider_event_id,receipt_id,payload_digest,contract_id,cycle_id,tenant_id,account_id,outcome,applied_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(...identity,input.receiptId,input.payloadDigest,input.contractId,input.cycleId,scope.tenantId,scope.accountId,input.outcome,at)];
}
export async function recordMonthlyEventApplication(db: D1Database, scope: MonthlyScope, input: MonthlyEventApplication, at: string,
  effects: D1PreparedStatement[] = []): Promise<{ replayed: boolean }> {
  try { await db.batch([...prepareMonthlyEventApplication(db,scope,input,at),...effects]); return { replayed: false }; }
  catch(error) {
    const saved = await db.prepare(`SELECT * FROM booking_monthly_event_applications
      WHERE source=? AND connected_account=? AND provider_event_id=?`).bind(input.source,input.connectedAccount,input.eventId)
      .first<{tenant_id:string;account_id:string;contract_id:string;cycle_id:string|null;payload_digest:string;receipt_id:string;outcome:string}>();
    if (saved) {
      if (saved.tenant_id===scope.tenantId && saved.account_id===scope.accountId && saved.contract_id===input.contractId
        && saved.cycle_id===input.cycleId && saved.payload_digest===input.payloadDigest && saved.receipt_id===input.receiptId && saved.outcome===input.outcome) return { replayed: true };
      throw new MonthlyLedgerError('monthly_event_conflict');
    }
    if(error instanceof Error && /monthly_event_conflict|malformed JSON|UNIQUE constraint failed: booking_monthly_event_applications/.test(error.message)) throw new MonthlyLedgerError('monthly_event_conflict');
    throw error;
  }
}
