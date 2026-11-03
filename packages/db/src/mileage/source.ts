import { isAccountFeatureEnabled } from '../account-settings.js';

/** 同じ店舗が先頭を占め続けないよう、5分ごとに処理対象の窓を進める。 */
export function selectMileageAccountBatch(accounts: string[], now: string, limit = 40): string[] {
  if (accounts.length <= limit) return accounts;
  const time = Date.parse(now);
  const slot = Number.isFinite(time) ? Math.floor(time / 300_000) : 0;
  const start = ((slot * limit) % accounts.length + accounts.length) % accounts.length;
  return Array.from({ length: limit }, (_, index) => accounts[(start + index) % accounts.length]!);
}

/** EC は included・依存なし。設定・接続・会員データの同じ判定を全経路で使う。 */
export async function resolveMileageSource(db: D1Database, accountId: string): Promise<'ec' | 'musubo'> {
  const setting = await db.prepare(`SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'feature.specialized.catalog'`).bind(accountId).first<{ value: string }>();
  if (setting?.value != null) {
    const parsed: unknown = JSON.parse(setting.value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) throw new Error('mileage_source_catalog_invalid');
    if (!parsed.includes('ec_commerce')) return 'musubo';
  }
  if (!await isAccountFeatureEnabled(db, accountId, 'ec_commerce')) return 'musubo';
  const connected = await db.prepare(`SELECT 1 AS present WHERE EXISTS (SELECT 1 FROM ec_connectors WHERE line_account_id = ? AND provider = 'ec_cube' AND status = 'connected')
    OR EXISTS (SELECT 1 FROM nen_ec_member_snapshots s JOIN friends f ON f.id = s.friend_id WHERE f.line_account_id = ?)`)
    .bind(accountId, accountId).first<{ present: number }>();
  return connected?.present === 1 ? 'ec' : 'musubo';
}
