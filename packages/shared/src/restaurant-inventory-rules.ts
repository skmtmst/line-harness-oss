/** 店頭・電話の枠は自動停止しない。sameDayCapacity はそれ以外の当日受付。 */
export interface RestaurantInventoryRules {
  storeId: string; threshold: number; stopLine: boolean; stopSameDay: boolean; notify: boolean; version: number;
}
export type RestaurantInventoryRulesInput = Omit<RestaurantInventoryRules, 'version'> & { expectedVersion: number };
export interface RestaurantChannelCloseTask {
 reservationId?:string;
  id: string; storeId: string; slotId: string | null; startsAt: string; channel: string;
  status: 'close' | 'done' | 'reopen'; reason: 'full' | 'limited' | 'table_conflict';
  remainingSeats: number | null; recipientIds: string[]; createdAt: string; updatedAt: string;
}
