import type { Context } from 'hono';
import { fail } from '../lib/fail.js';
import { resolveMileageSource } from './mileage-ec-source.js';

/** 判定不能も書き込みを止め、既存の保留は変更しない。 */
export async function blockEcMileageWrite(c: Context, accountId: string): Promise<Response | null> {
  let source: 'ec' | 'musubo';
  try { source = await resolveMileageSource(c.env.DB, accountId); }
  catch { return fail(c, 503, 'MILEAGE_SOURCE_UNAVAILABLE', { code: 'MILEAGE_SOURCE_UNAVAILABLE', error: 'マイルの管理元を確認できませんでした' }); }
  return source === 'ec' ? fail(c, 409, 'MILEAGE_MANAGED_BY_EC', { code: 'MILEAGE_MANAGED_BY_EC', error: 'マイルはECで管理しています' }) : null;
}
