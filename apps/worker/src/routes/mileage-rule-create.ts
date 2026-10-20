import type { MileageRuleRow } from '@line-crm/db';
import { completeOutboundSendStatement, hashOutboundPayload, reserveOutboundSend } from '../services/outbound-idempotency.js';
import { getMileageRuleById, ensureDefaultMileageProgram, jstNow } from '@line-crm/db';
import type { MileageRuleCreateInput } from './scoring-definition.js';


export function serializeMileageRule(rule: MileageRuleRow) {
  let conditions: Record<string, unknown> = {};
  if (rule.conditions) {
    try { conditions = JSON.parse(rule.conditions) as Record<string, unknown>; } catch { conditions = {}; }
  }
  return {
    id: rule.id,
    name: rule.name,
    eventType: rule.event_type,
    source: rule.source,
    amount: rule.amount,
    initialStatus: rule.initial_status,
    conditions,
    // 334(#521): 帰属アカウント。null は変更不可の既存全店ルール。
    lineAccountId: rule.line_account_id ?? null,
    isActive: Boolean(rule.is_active),
    validFrom: rule.valid_from,
    validUntil: rule.valid_until,
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
  };
}


/**
 * N-240(#813): 決めごと作成の冪等。reminders の N-067 と同じ約束:
 * - keyは `mileage-rule:<account>:<requestKey>` でaccountごとに名前空間を分ける
 * - 同一key＋同一内容→同じrule ID・同じ応答（行は1件）
 * - 同一key＋別内容→409（上書きしない）
 * - 予約後・作成前の失敗は in_progress のまま残し、再送は同じ束で回収する
 * - 同時押下はIDをkeyから決めるため何回通っても1行に収まる
 * - 入力不備・権限拒否は予約を残さない（route側で先に検査する）
 */
export async function mileageRuleIdForKey(namespacedKey: string): Promise<string> {
  const hex = await hashOutboundPayload(namespacedKey);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}


export async function createMileageRuleIdempotent(
  db: D1Database,
  args: MileageRuleCreateInput & { requestKey: string },
): Promise<{ status: 201 | 409; body: unknown }> {
  // 衝突判定は保存される値だけを正規化する。保存に影響しない余分は入れない。
  const normalized = {
    lineAccountId: args.lineAccountId,
    name: args.name,
    eventType: args.eventType,
    source: args.source,
    amount: args.amount,
    initialStatus: args.initialStatus ?? 'available',
    conditions: args.conditions ?? null,
    validFrom: args.validFrom,
    validUntil: args.validUntil,
    // 稼働/停止も保存される値なので衝突判定に含める（止めるはずの再送が
    // 稼働中の行を回収しないよう、同じkeyで別状態は409にする）。
    isActive: args.isActive !== false,
  };
  const namespacedKey = `mileage-rule:${args.lineAccountId}:${args.requestKey}`;
  const now = new Date().toISOString();
  const reservation = await reserveOutboundSend(db, {
    key: namespacedKey,
    channel: 'line',
    resourceId: args.lineAccountId,
    payloadHash: await hashOutboundPayload(JSON.stringify(normalized)),
    retryInProgress: true,
    now,
  });
  if (reservation.kind === 'conflict') {
    return { status: 409, body: { success: false, error: '同じ登録キーを別の内容には使用できません' } };
  }
  if (reservation.kind === 'replay') {
    const existing = await getMileageRuleById(db, reservation.responseId);
    if (existing) {
      return { status: 201, body: { success: true, data: serializeMileageRule(existing) } };
    }
    // 成功確定のはずが行方不明。下の束で作り直す（INSERT OR IGNORE のため安全）。
  }
  const ruleId = await mileageRuleIdForKey(namespacedKey);
  await ensureDefaultMileageProgram(db);
  const nowJst = jstNow();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO mileage_rules
         (id, program_id, name, event_type, source, amount, initial_status,
          conditions, line_account_id, is_active, valid_from, valid_until, created_at, updated_at)
       VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ruleId,
      args.name,
      args.eventType,
      args.source,
      args.amount,
      args.initialStatus ?? 'available',
      args.conditions ? JSON.stringify(args.conditions) : null,
      args.lineAccountId,
      args.isActive === false ? 0 : 1,
      args.validFrom,
      args.validUntil,
      nowJst,
      nowJst,
    ),
    completeOutboundSendStatement(db, { key: namespacedKey, responseId: ruleId, now }),
  ]);
  const created = await getMileageRuleById(db, ruleId);
  if (!created) throw new Error('mileage rule idempotency recovery failed');
  return { status: 201, body: { success: true, data: serializeMileageRule(created) } };
}
