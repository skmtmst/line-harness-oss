export interface VisitStampReward { id: string; name: string; stamps: number }
export interface VisitStampMultiplier {
  name?: string; active?: boolean; multiplier: number; from?: string; to?: string; weekdays?: number[];
  startMinute?: number; endMinute?: number;
}
/** 計算順: 基本個数→初回ボーナス→期間/曜日/時間の倍率を配列順→最高ランク倍率→切捨て→上限。 */
export interface VisitStampSettings {
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
export interface VisitStampUseResult { id:string; status:'used'; staffId:string; staffName:string }
export interface VisitStampPhoto { id:string; photoUrl:string; contentType:string; size:number }
