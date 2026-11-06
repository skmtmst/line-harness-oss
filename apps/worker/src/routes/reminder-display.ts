import { getReminders } from '@line-crm/db';

export type ReminderListRow = Awaited<ReturnType<typeof getReminders>>[number] & {
  step_count?: number | string | null;
  has_failure?: number | string | null;
  planned_count?: number | string | null;
  failed_count?: number | string | null;
  next_scheduled_at?: string | null;
};

export function publicReminder(row: ReminderListRow, stepCount?: number, hasFailure?: boolean, timingSummary?: string | null) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: Boolean(row.is_active),
    lifecycleStatus: row.lifecycle_status,
    currentDraftVersionId: row.current_draft_version_id,
    currentPublishedVersionId: row.current_published_version_id,
    triggerType: row.trigger_type ?? 'manual',
    deliveryMode: row.delivery_mode ?? 'countdown',
    triggerFieldId: row.trigger_field_id ?? null,
    repeatYearly: row.repeat_yearly === 1,
    leapYearPolicy: row.leap_year_policy,
    triggerOffsetMinutes: row.trigger_offset_minutes ?? null,
    sendAtTime: row.send_at_time ?? null,
    targetTagId: row.target_tag_id ?? null,
    folderId: row.folder_id ?? null,
    stepCount: stepCount ?? Number(row.step_count ?? 0),
    /*
     * REMINDER-10: 一覧の副題（日時・通数）。版から組み立てた値を渡す。
     * null のとき画面側が reminders 行の値で組み立てる従来の形に戻る。
     */
    timingSummary: timingSummary ?? null,
    hasFailure: hasFailure ?? Number(row.has_failure ?? 0) > 0,
    /*
     * ★V8 一覧（``）の「これから送る」「次に送る」「失敗 N」。
     * ページ切替の経路でだけ数える（旧配列応答は null のまま）。
     * 数え方は「失敗あり」の絞り込みと同じ retry_wait/permanent_failed、
     * 予定は queued/retry_wait の先に送るもの。
     */
    plannedDeliveries: row.planned_count == null ? null : Number(row.planned_count),
    failedCount: row.failed_count == null ? null : Number(row.failed_count),
    nextScheduledAt: row.next_scheduled_at ?? null,
    displayOrder: row.display_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
