/** 店頭・電話の枠は自動停止しない。sameDayCapacity はそれ以外の当日受付。 */
export interface RestaurantInventoryRules {
  storeId: string; threshold: number; stopLine: boolean; stopSameDay: boolean; notify: boolean; version: number;
}
export type RestaurantInventoryRulesInput = Omit<RestaurantInventoryRules, 'version'> & { expectedVersion: number };
/** 指定日の停止状態と配分変更。顧客情報や予約IDを含めない。 */
export interface RestaurantInventoryRuleState {
 stopped: Array<{slotId:string;startsAt:string;lineOriginal:number|null;sameDayOriginal:number|null;remainingSeats:number;threshold:number}>;
 stoppedTotal: number;
 history: Array<{id:number;startsAt:string;beforeLine:number;afterLine:number;beforeSameDay:number;afterSameDay:number;cause:'reservation'|'tables'|'rules'|'inventory';createdAt:string}>;
 historyTotal: number;
}
export interface RestaurantChannelCloseTask {
 reservationId?:string; closureId?:string; closureVersion?:number; closureKind?:import('./restaurant-closures').RestaurantClosureKind;
 startDate?:string; endDate?:string; allDay?:boolean; startTime?:string|null; endTime?:string|null; tableIds?:string[]; endsAt?:string;
  id: string; storeId: string; slotId: string | null; startsAt: string; channel: string;
  status: 'close' | 'done' | 'reopen'; reason: 'full' | 'limited' | 'table_conflict' | 'closure';
  triggerReservationId?: string | null;
  /** 同じ回の照合へ届いた予約変更。複数起点を1件へ推測しない。 */
  triggerSources?: Array<{reservationId:string;source:string;event:string}>;
  /** 発生時に保存した経路。複数経路・過去の不明な在庫・休業はnull。 */
  source?: string | null;
  generation?: number;
  /** 再開の確認は、閉鎖済みと別にこの世代だけへ記録する。 */
  opened?: boolean;
  remainingSeats: number | null; recipientIds: string[]; createdAt: string; updatedAt: string;
}
