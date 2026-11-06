/** 月謝の業務状態。Stripeの外部状態とは区別し、カード・口座のIDは公開しない。 */
export type MonthlyContractState = 'applying' | 'expired' | 'active' | 'stop_scheduled' | 'stopped';
export type MonthlyCycleState = 'planned' | 'preparing' | 'open' | 'retry_wait' | 'requires_action' | 'processing' | 'unknown' | 'paid' | 'exhausted' | 'blocked' | 'void';
export type MonthlyStopReason = 'member_request' | 'store_request' | 'store_immediate' | 'unpaid';
export type MonthlyRightState = 'paid' | 'provisional' | 'revoked' | 'review_hold';
export type MonthlyClassKind = 'menu' | 'event';
export interface MonthlyCycleView {
  id: string;
  monthKey: string;
  kind: 'initial' | 'renewal';
  state: MonthlyCycleState;
  dueAt: string;
  serviceStart: string;
  serviceEnd: string;
  amount: number;
  currency: 'jpy';
  paidAt: string | null;
  rightState: MonthlyRightState | null;
}
export interface MonthlyContractView {
  id: string;
  planId: string;
  name: string;
  classKind: MonthlyClassKind;
  classId: string;
  amount: number;
  currency: 'jpy';
  monthlyLimit: number | null;
  timezone: string;
  state: MonthlyContractState;
  serviceState: 'enabled' | 'review_hold';
  stopReason: MonthlyStopReason | null;
  stopEffectiveAt: string | null;
  version: number;
  cycles: MonthlyCycleView[];
}
/** 後続の申込APIへ渡す入力。金額・接続先・本人IDはサーバーで解決する。 */
export interface MonthlyApplyInput {
  planId: string;
  expectedPlanVersion: number;
  classKind: MonthlyClassKind;
  classId: string;
  consentVersion: string;
  accepted: true;
}
export interface MonthlyOperationInput {
  expectedVersion: number;
  reason: string;
}
export interface MonthlyWaiverInput extends MonthlyOperationInput {
  cycleId: string;
  confirmed: true;
  secondaryConfirmed: true;
}
