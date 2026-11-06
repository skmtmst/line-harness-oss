import { API_RETRY_WAIT, lineFailure } from '../../lib/external-call/index.js';
import { type CallState } from '../../lib/external-call/types.js';
import { runBookingExternalStep } from './booking-external-step.js';

export class BookingLineDeliveryIncomplete extends Error {
  constructor(readonly kind: string,readonly beforeSend=false,readonly nextAt?:number) { super(kind === 'unknown' ? 'delivery_unknown' : 'delivery_incomplete'); }
}
/** UUIDは論理操作から一度だけ決まる。宛先・本文・認証情報はキーに埋めない。 */
export async function bookingRetryKey(operationId: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(operationId))).slice(0,16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** 予約の保存取引へ予定を積む側と、送信側で同じ不変の入力を使う。 */
export async function bookingLinePlan<S>(input:{accountId:string;operationId:string;snapshot:S;retryKey?:string;
  deadlineAt?:number;maxAttempts?:number;now?:()=>number}) {
  const now=input.now??Date.now;
  return {
    ref:{scopeId:`line:${input.accountId}`,processKind:'booking_line_delivery',subjectId:input.operationId,stepKey:'send'},
    identity:{scope:{accountId:input.accountId,storeId:input.accountId,destination:'line',connectionId:input.accountId},
      operationId:input.operationId,snapshotId:input.operationId,idempotencyKey:input.retryKey??await bookingRetryKey(input.operationId),effect:'write' as const},
    policy:{category:'api' as const,maxAttempts:input.maxAttempts??1,timeoutMs:10_000,
      deadlineAt:input.deadlineAt??now()+86_400_000,wait:API_RETRY_WAIT},
    snapshot:input.snapshot,
  };
}

export async function deliverBookingLine<S>(db: D1Database, input: {
  accountId: string; operationId: string; snapshot: S; retryKey?: string;
  deadlineAt?: number; maxAttempts?: number; initialAttempts?: number; legacyUnknown?: boolean; now?: () => number;
  authorize(snapshot: Readonly<S>): Promise<boolean>;
  send(signal: AbortSignal, snapshot: Readonly<S>, key: string): Promise<unknown>;
  statements?(next: Readonly<CallState>): D1PreparedStatement[];
}): Promise<void> {
  const now = input.now ?? Date.now;
  const plan=await bookingLinePlan(input);
  const result = await runBookingExternalStep(db, {
    ...plan,
    initialAttempts: input.initialAttempts, legacyUnknown: input.legacyUnknown,
    snapshot: input.snapshot, now, authorize: input.authorize,
    execute: async (signal, saved, identity) => {
      try { await input.send(signal, saved, identity.idempotencyKey); return { kind: 'success', value: { accepted: true } }; }
      catch (error) { return lineFailure(error, identity, now()); }
    },
    statements: next => input.statements?.(next) ?? [],
  });
  if (result.kind !== 'success' && result.kind !== 'succeeded') throw new BookingLineDeliveryIncomplete(result.kind,result.state.phase==='ready',result.kind==='deferred'?result.nextAt:undefined);
}
