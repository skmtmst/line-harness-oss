import { logger } from '@line-crm/shared/server';

/** 移行前は従来の照合に戻す。移行直後も反映されるよう結果は保存しない。 */
export async function hasConversionApprovalRevision(db: D1Database): Promise<boolean> {
  const columns = await db.prepare('PRAGMA table_info(conversion_events)').all<{ name: string }>();
  const available = columns.results.some(column => column.name === 'approval_revision');
  if (!available) logger.warn('conversion_approval_revision_unavailable');
  return available;
}
