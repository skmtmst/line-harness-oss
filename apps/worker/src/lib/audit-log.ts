import type { Context } from 'hono';
import { auditDeviceFamily, maskAuditIp, recordAuditEvent } from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * お金が動く操作の記録。
 *
 * マイルとアフィリエイトは残高や報酬に直結するため、
 * 「誰がいつ何を変更したか」を残す。
 *
 * 構造化ログと共通監査台帳の両方へ残す。ログ集約側と管理画面のどちらでも
 * actor と action で絞れるよう、キーは固定にしている。
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
  | 'conversion.definition.create'
  | 'conversion.definition.stop'
  | 'conversion.definition.replace'
  | 'conversion.definition.revise'
  | 'conversion.definition.delete'
  | 'conversion.definition.usage.create'
  | 'conversion.report.export'
  | 'ec.connector.update'
  | 'ec.action.retry'
  | 'line_notification.definition.create'
  | 'line_notification.definition.update'
  | 'line_notification.definition.publish'
  | 'line_notification.definition.stop'
  | 'line_notification.delivery.retry'
  | 'nen.column.duplicate'
  | 'nen.delivery.pending_now'
  | 'operator_notification.rule.publish'
  | 'operator_notification.rule.test'
  | 'operator_notification.delivery.export'
  | 'nen.delivery.retry'
  | 'photo.assessment.request'
  | 'photo.asset.request'
  | 'photo.review.bulk'
  | 'media.download'
  | 'photo.original.issue'
  | 'photo.original.download'
  | 'webinar.archive'
  | 'webinar.publish'
  | 'webinar.pause'
  | 'webinar.duplicate'
  | 'webinar.participant.export';

function commonAuditWriter(): typeof recordAuditEvent | null {
  try {
    return typeof recordAuditEvent === 'function' ? recordAuditEvent : null;
  } catch {
    // 一部のroute単体テストはDB packageを必要な関数だけに絞ってmockする。
    return null;
  }
}

/**
 * 統括の境界で止めた要求のうち、routeまで届かずとも正規の操作名で
 * 残すべきもの。route側の監査は上流で止まると動かないため、境界自身が
 * 同じ操作名・同じ結果で1件だけ残す。二重記録にしないよう、ここに載った
 * 操作の拒否は境界側が持ち、route側の同じ記録は直接掛けの場合の
 * 予備として残す。本番の順序では境界で止まるため二重にはならない。
 */
const CANONICAL_DENY_AUDITS: Array<{
  method: string;
  pattern: RegExp;
  action: AuditAction;
  kind: string;
}> = [
  { method: 'GET', pattern: /^\/api\/media\/([^/]+)\/download(?:\/|$)/, action: 'media.download', kind: 'media' },
];

export function canonicalDenyAuditFor(
  method: string,
  path: string,
): { action: AuditAction; kind: string; id: string | null } | null {
  for (const entry of CANONICAL_DENY_AUDITS) {
    if (method.toUpperCase() !== entry.method) continue;
    const match = entry.pattern.exec(path);
    if (!match) continue;
    return { action: entry.action, kind: entry.kind, id: match[1] ?? null };
  }
  return null;
}

export function auditLog(
  c: Context<Env>,
  action: AuditAction,
  target?: { id?: string | null; kind?: string },
  opts?: { result?: 'success' | 'denied' | 'failed'; lineAccountId?: string | null },
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
  const writer = commonAuditWriter();
  if (!db || typeof db.prepare !== 'function' || !writer) return;
  const lineAccountId = opts?.lineAccountId
    ?? c.req.query('lineAccountId') ?? c.req.query('account_id') ?? null;
  const task = writer(db, {
    tenantId: staff?.tenantId,
    lineAccountId,
    category: 'business',
    actorPrincipalId: staff?.id,
    actorRole,
    action,
    targetKind: target?.kind ?? null,
    targetId: target?.id ?? null,
    result: opts?.result ?? 'success',
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
