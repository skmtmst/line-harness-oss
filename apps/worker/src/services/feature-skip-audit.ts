import { logger } from '@line-crm/shared/server';
import { recordAuditEvent } from '@line-crm/db';
import { type FeatureId } from '@line-crm/shared';

export async function recordFeatureExecutionSkipped(
  db: D1Database,
  input: { accountId: string; featureId: FeatureId; job: string; occurredAt?: string },
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  logger.info("feature.execution.skipped");
  // 同じ job が5分ごとに監査表を増やさないよう、日・account・feature・job を
  // 一意な監査IDにする。構造化ログはtickごとの観測用なので毎回残す。
  const auditId = `feature-skip:${occurredAt.slice(0, 10)}:${input.accountId}:${input.featureId}:${input.job}`;
  try {
    await recordAuditEvent(db, {
      id: auditId,
      lineAccountId: input.accountId,
      category: 'business',
      actorPrincipalId: 'system',
      actorRole: 'system',
      action: 'feature.execution.skipped',
      targetKind: 'scheduled_job',
      targetId: input.job,
      result: 'denied',
      createdAt: occurredAt,
    });
  } catch (error) {
    if (!String(error).toLowerCase().includes('unique')) throw error;
  }
}
