export const VISIT_STAMP_DEFAULT_COLOR = '#7b4a2e';
export function visitStampDarkInk(color: string): boolean {
  const parts = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722 > 0.179;
}
export interface VisitStampReward { id: string; name: string; stamps: number }
export interface VisitStampMultiplier {
  name?: string; active?: boolean; multiplier: number; from?: string; to?: string; weekdays?: number[];
  startMinute?: number; endMinute?: number;
}
/** 計算順: 基本個数→初回ボーナス→期間/曜日/時間の倍率を配列順→最高ランク倍率→切捨て→上限。 */
export interface VisitStampSettings {
  backgroundColor?: string; backgroundImageUrl?: string | null;
  expiryBasis?: 'last_visit' | 'first_visit' | 'none';
  expiryReminder?: 'day_before' | 'three_days_before' | 'week_before' | 'two_weeks_before' | 'month_before' | 'none';
  completion?: 'repeat' | 'next_card'; nextCardId?: string | null;
  instructions?: string;
  stampInterval?: { mode: 'same_day' | 'hours' | 'none'; hours?: number };
  receiptBonus?: number;
  slotCount?: number; maxStackedStamps?: number; stackingOrder?: 'bonus_then_multipliers'|'multipliers_then_bonus';
  mode: 'visit' | 'amount'; amountUnit: number; maxPerVisit: number;
  firstVisitBonus: number; expiryMonths: number | null; timezone: string;
  multipliers: VisitStampMultiplier[]; rankMultipliers: Array<{ tagName: string; multiplier: number; name?: string; active?: boolean }>;
  rewards: VisitStampReward[];
}
export interface VisitStampCardInput { name: string; accountIds: string[]; settings: VisitStampSettings; expectedVersion: number; active: boolean }
export interface VisitStampCard extends VisitStampCardInput { id: string; version: number }
export interface VisitStampWallet { cardId: string; friendId: string; balance: number; earnedTotal: number; expiresAt: string | null }
export interface VisitStampEntry { id: string; cardId: string; friendId: string; accountId: string; kind: string; delta: number; actorId: string | null; reason: string; createdAt: string; originalId: string | null }
export interface VisitStampPaperInput { photoUrl: string; stamps: number }
export interface VisitStampRedemption { id: string; cardId: string; rewardId: string; rewardName: string; stamps: number; status: 'offered'|'used'|'cancelled' }

export interface VisitStampPaperRequest { id:string; cardId:string; photoUrl:string; stamps:number; status:'pending'|'approved'|'rejected'; reason:string|null; createdAt:string; reviewedAt:string|null }
export interface VisitStampEntryPage { items:VisitStampEntry[]; total:number; page:number; pageSize:number }
export interface VisitStampEntryQuery { accountId:string; from?:string; to?:string; friendId?:string; kind?:string; page?:number; pageSize?:number }
export interface VisitStampUseResult { id:string; status:'used'; staffId:string; staffName:string; nextCardId?:string }
export interface VisitStampPhoto { id:string; photoUrl:string; contentType:string; size:number }
