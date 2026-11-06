import type { RestaurantReservationFormHealth } from './restaurant-reservation-form.js';
/** 選んでいる1店舗の設定状況。空席数や予約件数は完了条件にしない。 */
export interface RestaurantSetupProgress {
  storeId: string;
  tables: boolean;
  hours: boolean;
  menus: boolean;
  reception: boolean;
  followup: boolean;
  reservationForm?: RestaurantReservationFormHealth;
  /** 保存機能導入後のSELECT集計。未提供時は従来のfollowupを使う。 */
  followupSetup?: { notUsing: boolean; decidedAt: string | null; version: number; anyEnabled: boolean };
}
