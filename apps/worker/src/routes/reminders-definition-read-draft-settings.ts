import { type Context } from 'hono';
import { getReminderById, getReminderSteps, listReminderRegistrants, moveReminderRegistrantTargetDate, getReminderRegistrantById, getReminderVersionSteps, type ResumeExpectedRun, parseReminderVersionSettings, type ReminderDraftSettings, type ReminderVersionRow } from '@line-crm/db';

import { LEAP_YEAR_POLICIES, REMINDER_NAME_MAX_LENGTH, REMINDER_NAME_TOO_LONG_MESSAGE, resolveReminderSendAt } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { buildPublicSegmentQuery, isEmptySegmentCondition } from '../services/segment-query.js';
import { TRIGGER_TYPES, type TriggerType, DELIVERY_MODES, REMINDER_MESSAGE_TYPES, readTargetCondition } from './reminders-definition-is-reminder-row-scoped-path.js';

export function readDraftSettings(
  raw: unknown,
): { ok: true; value: ReminderDraftSettings } | { ok: false; error: string; status?: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '下書きの内容が正しくありません' };
  }
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const lineAccountId = typeof body.lineAccountId === 'string' ? body.lineAccountId.trim() : '';
  if (!name) return { ok: false, error: 'リマインダ名を入力してください' };
  // N-078: 画面の maxLength と同じ上限をサーバーでも守る。画面だけだと
  // API を直接叩かれたときに上限を越えた名前が入る。
  if (name.length > REMINDER_NAME_MAX_LENGTH) {
    return { ok: false, error: REMINDER_NAME_TOO_LONG_MESSAGE, status: 422 };
  }
  if (!lineAccountId) return { ok: false, error: 'LINEアカウントを選んでください' };
  if (!TRIGGER_TYPES.includes(body.triggerType as TriggerType)) {
    return { ok: false, error: '基準日の種類が正しくありません' };
  }
  if (!DELIVERY_MODES.includes(body.deliveryMode as (typeof DELIVERY_MODES)[number])) {
    return { ok: false, error: '送るタイミングの決め方が正しくありません' };
  }
  if (!Array.isArray(body.steps) || body.steps.length > 50) {
    return { ok: false, error: '通知ステップは50件以内で指定してください' };
  }

  const stableIds = new Set<string>();
  const steps: ReminderDraftSettings['steps'] = [];
  for (const rawStep of body.steps) {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      return { ok: false, error: '通知ステップの内容が正しくありません' };
    }
    const step = rawStep as Record<string, unknown>;
    const stableStepId = typeof step.stableStepId === 'string' && step.stableStepId.trim()
      ? step.stableStepId.trim()
      : crypto.randomUUID();
    if (stableIds.has(stableStepId)) return { ok: false, error: '同じ通知ステップIDが重複しています' };
    stableIds.add(stableStepId);
    const offsetMinutes = Number(step.offsetMinutes ?? 0);
    const offsetDays = step.offsetDays == null ? null : Number(step.offsetDays);
    const sendAtTime = step.sendAtTime == null || step.sendAtTime === ''
      ? null
      : String(step.sendAtTime);
    if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 525_600) {
      return { ok: false, error: '通知時刻は基準日の前後365日以内にしてください' };
    }
    if (offsetDays !== null && (!Number.isInteger(offsetDays) || Math.abs(offsetDays) > 365)) {
      return { ok: false, error: '通知日は基準日の前後365日以内にしてください' };
    }
    if (sendAtTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendAtTime)) {
      return { ok: false, error: '通知時刻はHH:MMで指定してください' };
    }
    const messageType = String(step.messageType ?? 'text');
    if (!REMINDER_MESSAGE_TYPES.has(messageType)) {
      return { ok: false, error: '送る内容の種類が正しくありません' };
    }
    const objectOrEmpty = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const templateId = typeof step.templateId === 'string' && step.templateId ? step.templateId : null;
    const messageContent = typeof step.messageContent === 'string' ? step.messageContent : '';
    // 公開前検査と同じく、型紙なしの空本文はここで止める。空の通は届いても
    // 何も表示されず、公開時に初めて気づくことになる。
    if (!templateId && !messageContent.trim()) {
      return { ok: false, error: '送る内容が空の通知があります', status: 422 };
    }
    if (messageContent.length > 5000) {
      return { ok: false, error: '送る内容は5000文字以内で指定してください', status: 422 };
    }
    steps.push({
      stableStepId,
      offsetMinutes,
      messageType,
      messageContent,
      offsetDays,
      sendAtTime,
      templateId,
      targetCondition: objectOrEmpty(step.targetCondition),
      action: objectOrEmpty(step.action),
    });
  }

  const stop = body.stopConditions && typeof body.stopConditions === 'object' && !Array.isArray(body.stopConditions)
    ? body.stopConditions as Record<string, unknown>
    : {};
  const daysAfterTarget = stop.daysAfterTarget == null ? null : Number(stop.daysAfterTarget);
  if (daysAfterTarget !== null && (!Number.isInteger(daysAfterTarget) || daysAfterTarget < 0 || daysAfterTarget > 365)) {
    return { ok: false, error: '自動終了日は0〜365日で指定してください' };
  }
  const triggerOffsetMinutes = body.triggerOffsetMinutes == null
    ? null
    : Number(body.triggerOffsetMinutes);
  if (triggerOffsetMinutes !== null
      && (!Number.isInteger(triggerOffsetMinutes) || Math.abs(triggerOffsetMinutes) > 43_200)) {
    return { ok: false, error: '基準日からのずらし方は前後30日以内で指定してください' };
  }
  const sendAtTime = typeof body.sendAtTime === 'string' && body.sendAtTime ? body.sendAtTime : null;
  if (sendAtTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendAtTime)) {
    return { ok: false, error: '送る時刻はHH:MMで指定してください' };
  }
  const leapYearPolicy = body.leapYearPolicy == null
    ? undefined
    : (LEAP_YEAR_POLICIES as readonly string[]).includes(body.leapYearPolicy as string)
      ? body.leapYearPolicy as 'feb28' | 'mar1' | 'skip'
      : undefined;
  if (body.leapYearPolicy != null && leapYearPolicy === undefined) {
    return { ok: false, error: '2月29日の扱いが正しくありません' };
  }
  const targetCondition = readTargetCondition(body.targetCondition);
  if (!targetCondition.ok) {
    return { ok: false, error: targetCondition.error, status: 422 };
  }
  return {
    ok: true,
    value: {
      name,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      lineAccountId,
      triggerType: body.triggerType as ReminderDraftSettings['triggerType'],
      deliveryMode: body.deliveryMode as ReminderDraftSettings['deliveryMode'],
      triggerFieldId: typeof body.triggerFieldId === 'string' && body.triggerFieldId ? body.triggerFieldId : null,
      triggerEventId: typeof body.triggerEventId === 'string' && body.triggerEventId ? body.triggerEventId : null,
      repeatYearly: body.repeatYearly === true,
      leapYearPolicy,
      triggerOffsetMinutes,
      sendAtTime,
      targetTagId: typeof body.targetTagId === 'string' && body.targetTagId ? body.targetTagId : null,
      targetCondition: targetCondition.value ?? null,
      folderId: typeof body.folderId === 'string' && body.folderId ? body.folderId : null,
      stopConditions: {
        bookingCancelled: stop.bookingCancelled !== false,
        supportMarkCompleted: stop.supportMarkCompleted === true,
        daysAfterTarget,
        friendBlocked: stop.friendBlocked !== false,
      },
      steps,
    },
  };
}

export async function validateReminderDraftReferences(
  db: D1Database,
  settings: ReminderDraftSettings,
): Promise<string | null> {
  if (settings.targetTagId) {
    const tag = await db.prepare(
      `SELECT id FROM tags WHERE id = ? AND (line_account_id = ? OR line_account_id IS NULL)`,
    ).bind(settings.targetTagId, settings.lineAccountId).first<{ id: string }>();
    if (!tag) return '対象タグが見つかりません';
  }
  // 保存時に形は見ているが、公開・検証・送信の口でも組み立て直す。
  // 壊れた条件のまま数えると「誰もいない」と見え、公開へ進めてしまう。
  if (!isEmptySegmentCondition(settings.targetCondition as never)) {
    try {
      buildPublicSegmentQuery(settings.targetCondition as never);
    } catch {
      return '対象の条件を読めません';
    }
  }
  if (settings.triggerFieldId) {
    const field = await db.prepare(
      `SELECT ff.id FROM friend_fields ff
        LEFT JOIN friend_field_scopes ffs ON ffs.field_id = ff.id
       WHERE ff.id = ? AND (ffs.line_account_id = ? OR ffs.line_account_id IS NULL)`,
    ).bind(settings.triggerFieldId, settings.lineAccountId).first<{ id: string }>();
    if (!field) return '基準日に使う友だち情報欄が見つかりません';
  }
  if (settings.triggerEventId) {
    const event = await db.prepare(
      `SELECT id FROM events
        WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
    ).bind(settings.triggerEventId, settings.lineAccountId).first<{ id: string }>();
    if (!event) return '基準日に使うイベントが見つかりません';
  }
  for (const step of settings.steps) {
    if (!step.templateId) continue;
    const template = await db.prepare(
      `SELECT id FROM templates
        WHERE id = ? AND (line_account_id = ? OR line_account_id IS NULL)`,
    ).bind(step.templateId, settings.lineAccountId).first<{ id: string }>();
    if (!template) return '通知に使うテンプレートが見つかりません';
  }
  return null;
}

export function versionResponse(row: ReminderVersionRow, fallbackLeapYearPolicy?: 'feb28' | 'mar1' | 'skip') {
  const settings = parseReminderVersionSettings(row);
  // 419 より前に保存された版には leapYearPolicy が無い。その場合は
  // reminders 行の現在値（移行で 'mar1' が入っている）を見せる。
  // 画面の既定 'feb28' で埋めると、開いて保存するだけで方針が無断で変わる。
  if (settings.leapYearPolicy === undefined && fallbackLeapYearPolicy) {
    settings.leapYearPolicy = fallbackLeapYearPolicy;
  }
  return {
    reminderId: row.reminder_id,
    versionId: row.id,
    versionNumber: Number(row.version_number),
    status: row.status,
    settings,
    lastTestStatus: row.last_test_status,
    lastTestedAt: row.last_tested_at,
    publishedAt: row.published_at,
    // R148 監査：保存のたびに変わる版時刻。画面は開いたときの値を保存時に
    // 送り返し、ずれていれば別の画面の先勝ちとして 409 で止める。
    updatedAt: row.updated_at,
  };
}

export function publicRegistrant(row: Awaited<ReturnType<typeof listReminderRegistrants>>[number]) {
  return {
    id: row.id,
    friendId: row.friend_id,
    friendName: row.friend_name,
    targetDate: row.target_date,
    status: row.status,
    reminderVersionId: row.reminder_version_id,
    sourceKind: row.source_kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.completed_at,
    lockVersion: row.lock_version,
  };
}

export function mutationResponse(
  c: Context<Env>,
  mutation: Awaited<ReturnType<typeof moveReminderRegistrantTargetDate>>,
) {
  if (mutation.state === 'not_found') return c.json({ success: false, error: '登録者が見つかりません' }, 404);
  if (mutation.state === 'conflict') return c.json({ success: false, error: 'ほかの担当者による変更があります。一覧を読み直してください。' }, 409);
  if (!('row' in mutation)) return c.json({ success: false, error: '登録者を更新できません' }, 500);
  const row = mutation.row;
  return c.json({
    success: true,
    data: {
      id: row.id,
      friendId: row.friend_id,
      targetDate: row.target_date,
      status: row.status,
      reminderVersionId: row.reminder_version_id,
      lockVersion: row.lock_version,
      replayed: mutation.state === 'replayed',
    },
  });
}

export /**
 * R341: 再開では取消の記録を外して未来の予定を作り直す。
 * 未来の予定時刻に対応する cancelled 行だけ queued へ戻し、行が無い通は
 * 新しく作る。送信ずみ・過去時刻の通には触らない。再開できないときは
 * 成功と返さない (409/500)。
 */
async function buildResumeExpectedRuns(
  db: D1Database,
  reminderId: string,
  enrollmentId: string,
  now: Date,
  scope?: { allowedAccountIds: string[]; canSeeUnassigned: boolean },
): Promise<ResumeExpectedRun[] | undefined> {
  const enrollment = await getReminderRegistrantById(db, reminderId, enrollmentId, scope);
  if (!enrollment || enrollment.status !== 'cancelled') return undefined;
  const target = new Date(enrollment.target_date);
  if (Number.isNaN(target.getTime())) return undefined;
  const reminder = await getReminderById(db, reminderId);
  // 一覧 (getPendingReminderDeliveries) と同じく、固定版の通を優先する。
  const steps = enrollment.reminder_version_id
    ? await getReminderVersionSteps(db, enrollment.reminder_version_id)
    : await getReminderSteps(db, reminderId);
  const mode = reminder?.delivery_mode === 'time' ? 'time' : 'countdown';
  const runs: ResumeExpectedRun[] = [];
  for (const step of steps) {
    const sendAt = resolveReminderSendAt(target, {
      offsetDays: step.offset_days,
      sendAtTime: step.send_at_time,
      offsetMinutes: step.offset_minutes,
    }, mode);
    if (sendAt.getTime() <= now.getTime()) continue;
    runs.push({ reminderStepId: step.id, scheduledAt: sendAt.toISOString() });
  }
  return runs;
}
