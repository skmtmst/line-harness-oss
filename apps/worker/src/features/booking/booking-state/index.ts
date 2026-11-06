// 不要な操作まで初期化しないよう、操作単位の公開入口を分ける。
export { canTransition, nextStatus } from '../booking-state.js';
export type { BookingAction } from '../booking-state.js';
