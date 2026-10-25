// 不要な操作まで初期化しないよう、操作単位の公開入口を分ける。
export { fetchQuota, releaseQuotaSlot, tryReserveQuotaSlot } from '../broadcast-quota-guard.js';
