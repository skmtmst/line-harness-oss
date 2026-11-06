// 内部から自分の公開入口を読み戻さず、実装の依存先を直接読む。
export { STORE_CAPACITY_GUARD_EXCLUDE_SQL, STORE_CAPACITY_GUARD_SQL, STORE_SETTINGS_VERSION_GUARD_SQL, storeSeatsForSlot } from '../booking-store-capacity.js';
export type { StoreCapacityWindow } from '../booking-store-capacity.js';
