/** 店舗の暦日・時刻で入力。空配列の卓は全卓。期間中の各日に同じ時間帯を適用する。 */
export type RestaurantClosureKind = 'temporary_closed' | 'private_event' | 'maintenance' | 'other';
export interface RestaurantClosureInput {
  storeId: string; startDate: string; endDate: string; allDay: boolean;
  startTime?: string | null; endTime?: string | null; kind: RestaurantClosureKind;
  memo?: string | null; tableIds?: string[];
}
export interface RestaurantClosure extends RestaurantClosureInput {
  id: string; startTime: string | null; endTime: string | null; memo: string | null;
  tableIds: string[]; createdBy: string | null; createdByName: string | null;
  createdAt: string; updatedAt: string; version: number;
}
export interface RestaurantClosureReservation {
  id: string; startsAt: string; endsAt: string; guestCount: number; customerName: string;
  source: string; tableId: string | null; friendId: string | null; isLineFriend: boolean;
}
export interface RestaurantClosurePreview {
  reservations: RestaurantClosureReservation[]; waitlistCount: number; conflicts: RestaurantClosure[];
}
export interface RestaurantClosureSaveResult extends RestaurantClosurePreview { closure: RestaurantClosure; }
export interface RestaurantSeatAvailability {
  storeId: string; startsAt: string; endsAt: string; guestCount: number;
  tables: Array<{ id: string; label: string; minCapacity: number; maxCapacity: number }>;
}
