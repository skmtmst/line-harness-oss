import type { Context } from 'hono';
import { auditDeviceFamily, maskAuditIp, recordAuditEvent } from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * お金が動く操作の記録。
 *
 * マイルとアフィリエイトは残高や報酬に直結するため、
 * 「誰がいつ何を変更したか」を残す。
 *
 * 現時点では構造化ログとして出す。DBへ残す形にすると保存先の設計と
 * マイグレーションが要るため、まず追跡できる状態を先に作る。
 * ログ集約側で actor と action で絞れるよう、キーは固定にしている。
 *
 * 値そのものは残さない。金額やマイル数は変更後の状態を見れば分かるし、
 * 個人情報をログへ流さないため。残すのは「誰が・いつ・何に対して・何をしたか」だけ。
 */

export type AuditAction =
  | 'mileage.rule.create'
  | 'mileage.rule.update'
  | 'mileage.rule.delete'
  | 'mileage.event.create'
  | 'mileage.adjustment.create'
  | 'mileage.adjustment.policy.update'
  | 'action_score.rules.draft.save'
  | 'action_score.rules.publish'
  | 'action_score.rules.stop'
  | 'mileage.reward.create'
  | 'mileage.reward.update'
  | 'mileage.reward.publish'
  | 'mileage.reward.status'
  | 'mileage.reward.codes.import'
  | 'mileage.redemption.create'
  | 'mileage.redemption.retry'
  | 'affiliate.create'
  | 'affiliate.update'
  | 'affiliate.delete'
  | 'affiliate.archive'
  | 'affiliate.settlement.close'
  | 'affiliate.bank.update'
  | 'affiliate.payout.create'
  | 'affiliate.payout.export'
  | 'affiliate.payout.download'
  | 'affiliate.statement.generate'
  | 'affiliate.statement.download'
  | 'affiliate.offer.create'
  | 'affiliate.offer.update'
  | 'dashboard.preference.update'
  | 'dashboard.preference.reset'
  | 'dashboard.preference.default.update'
  | 'conversion.approval.update'
  | 'conversion.definition.usage.create'
  | 'conversion.report.export'
  | 'ec.connector.update'
  | 'line_notification.definition.create'
  | 'line_notification.definition.update'
  | 'line_notification.definition.publish'
  | 'line_notification.definition.stop'
  | 'line_notification.delivery.retry'
  | 'nen.delivery.retry'
  | 'webinar.archive'
  | 'webinar.participant.export';

export function auditLog(
  c: Context<Env>,
  action: AuditAction,
  target?: { id?: string | null; kind?: string },
): void {
  const staff = c.get('staff');
  // 認証前に呼ばれることはない想定だが、ログのために例外を投げたくない。
  const actorId = staff?.id ?? 'unknown';
  const actorRole = staff?.role ?? 'unknown';
  c.set('auditRecorded', true);
  console.log(
    JSON.stringify({
      tag: 'audit',
      action,
      actorId,
      actorRole,
      targetKind: target?.kind ?? null,
      targetId: target?.id ?? null,
      at: new Date().toISOString(),
    }),
  );

  const db = c.env?.DB;
  if (!db || typeof db.prepare !== 'function') return;
  const lineAccountId = c.req.query('lineAccountId') ?? c.req.query('account_id') ?? null;
  const task = recordAuditEvent(db, {
    tenantId: staff?.tenantId,
    lineAccountId,
    category: 'business',
    actorPrincipalId: staff?.id,
    actorRole,
    action,
    targetKind: target?.kind ?? null,
    targetId: target?.id ?? null,
    result: 'success',
    requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
    ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
    deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
  }).catch((error: unknown) => {
    console.error('audit_events insert failed:', error instanceof Error ? error.name : 'unknown');
  });
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // 単体テスト等でExecutionContextが無い場合も、開始済みPromiseのcatchは維持する。
    void task;
  }
}
