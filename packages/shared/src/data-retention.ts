import spec from './data-retention.json';

/**
 * 顧客データの保存期間（★V6 36-2 / 退会後の保存）。
 *
 * 公開サイトの案内文と削除処理が別々の数字を持つと、案内と実際の運用がずれる。
 * そのため日数は data-retention.json だけに書き、
 * - TypeScript 側（Worker・DB）はこのファイル経由で読む
 * - pnpmワークスペース外の sites/musubo は同じ JSON を直接読む
 * という形で1か所に固定する。
 */
export const DATA_RETENTION_DAYS: number = spec.dataRetentionDays;

/** 保存期間をミリ秒で表したもの。削除期限の計算に使う。 */
export const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
