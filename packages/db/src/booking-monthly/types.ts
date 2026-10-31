import type { MonthlyClassKind, MonthlyContractState, MonthlyStopReason } from '@line-crm/shared';

export interface MonthlyScope { tenantId: string; accountId: string }
export interface MonthlyContractSnapshot {
  id: string; friendId: string; planId: string; planVersion: number; name: string;
  classKind: MonthlyClassKind; classId: string; amount: number; monthlyLimit: number | null;
  timezone: string; consentVersion: string; consentedAt: string;
  connectedAccount: string; connectionIdentity: string;
}
export interface MonthlyContractRow {
  id: string; tenant_id: string; account_id: string; friend_id: string;
  plan_id: string; plan_version: number; name: string; class_kind: MonthlyClassKind; class_id: string;
  amount: number; currency: 'jpy'; monthly_limit: number | null; timezone: string;
  state: MonthlyContractState; service_state: 'enabled' | 'review_hold';
  stop_reason: MonthlyStopReason | null; stop_effective_at: string | null; version: number;
  attention_started_at: string | null;
  request_key: string; request_json: string;
}
export class MonthlyLedgerError extends Error {
  constructor(public code: string, public status: 400 | 404 | 409 = 409) { super(code); }
}
