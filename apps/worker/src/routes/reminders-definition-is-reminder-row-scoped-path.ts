import { sqlIdSet } from '@line-crm/db/id-queries';
import { type Context } from 'hono';
import { getReminderById, getFolderById, type ReminderDraftSettings, type ReminderDeliveryRunStatus } from '@line-crm/db';

import { describeReminderTiming, LEAP_YEAR_POLICIES } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { completeOutboundSendStatement, hashOutboundPayload, reserveOutboundSend } from '../services/outbound-idempotency.js';
import { buildPublicSegmentQuery } from '../services/segment-query.js';

export /**
 * R348/R349: 親ではなく行の送信元アカウントで担当を判定する口。
 * 履歴・登録の一覧と、登録1件の操作（日時変更・取消・再開）が対象。
 */
function isReminderRowScopedPath(path: string): boolean {
  return /^\/api\/reminders\/[^/]+\/(runs|registrants([/?].*)?$)/.test(path);
}

export async function requireVisibleReminder(c: Context<Env>, next: () => Promise<void>) {
  // R348/R349: 履歴と登録は行ごとの送信元アカウントで見る。親ルールの
  // 今の所属だけで閉じると、所属変更後に旧登録が操作できなくなるため、
  // ここでは通して各 handler で行単位に判定する。
  if (isReminderRowScopedPath(c.req.path)) return next();
  // B 元に戻す: 削除の取り消しは消えた行自体が対象。所属だけ確かめて通す。
  if (c.req.path.endsWith('/restore')) {
    const row = await c.env.DB
      .prepare(`SELECT line_account_id FROM reminders WHERE id = ?`)
      .bind(c.req.param('id')!)
      .first<{ line_account_id: string | null }>();
    if (!row || !await canAccessAllLineAccounts(
      c.env.DB,
      c.get('staff'),
      [row.line_account_id ?? null],
    )) {
      return c.json({ success: false, error: 'Reminder not found' }, 404);
    }
    await next();
    return;
  }
  const reminder = await getReminderById(c.env.DB, c.req.param('id')!);
  if (!reminder || !await canAccessAllLineAccounts(
    c.env.DB,
    c.get('staff'),
    [(reminder as { line_account_id?: string | null }).line_account_id ?? null],
  )) {
    return c.json({ success: false, error: 'Reminder not found' }, 404);
  }
  await next();
}

export const TRIGGER_TYPES = ['manual', 'booking', 'event', 'friend_field'] as const;

export const DELIVERY_MODES = ['time', 'countdown'] as const;

export const RUN_STATUSES: ReminderDeliveryRunStatus[] = [
  'queued', 'claimed', 'succeeded', 'skipped',
  'retry_wait', 'permanent_failed', 'cancelled',
];

export function publicRunStatus(status: ReminderDeliveryRunStatus) {
  return status === 'queued' ? 'planned' as const : status;
}

export function commonRunStatus(status: ReminderDeliveryRunStatus) {
  if (status === 'succeeded') return 'succeeded' as const;
  if (status === 'permanent_failed') return 'failed' as const;
  if (status === 'skipped') return 'skipped' as const;
  if (status === 'cancelled') return 'cancelled' as const;
  return 'pending' as const;
}

export function canonicalTargetDate(value: unknown): string | null {
  // `datetime-local` のような曖昧な時刻を Worker 側で勝手に店舗時刻へ解釈しない。
  // API は必ず offset/Z つきの時刻だけを受け、保存値を UTC ISO へ正規化する。
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export interface ReminderVersionStepSummaryRow {
  reminder_version_id: string;
  offset_minutes: number;
  offset_days: number | null;
  send_at_time: string | null;
}

export /*
 * REMINDER-10: 一覧の「送信時刻・通数」を、画面で編集している版の実値から作る。
 *
 * reminder_steps は公開時に版から複製されるだけなので、まだ公開していない
 * 下書きでは常に0件・reminders行の作成時の値しか返らず、編集画面で保存した
 * 「1日前の18:00・1通」と一覧の「当日18:00・0通」が食い違っていた。
 *
 * 下書き版があれば下書き版、なければ公開版の通を使う。両方ある
 * （公開後に再編集中）ときは「下書き: 」を先頭に付けて、どの版の値かを
 * 一覧でも分かるようにする。版を持たない旧来の行は従来の値のまま。
 */
async function loadReminderListSummaries(
  db: D1Database,
  rows: ReadonlyArray<{
    id: string;
    current_draft_version_id?: string | null;
    current_published_version_id?: string | null;
    delivery_mode?: string | null;
  }>,
): Promise<Map<string, { stepCount: number; timingSummary: string }>> {
  const summaries = new Map<string, { stepCount: number; timingSummary: string }>();
  const versionIds = [
    ...new Set(
      rows
        .map((row) => row.current_draft_version_id ?? row.current_published_version_id ?? null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (versionIds.length === 0) return summaries;
  const steps = await db
    .prepare(
      `SELECT reminder_version_id, offset_minutes, offset_days, send_at_time
         FROM reminder_version_steps
        WHERE reminder_version_id IN (${sqlIdSet(versionIds).sql})
        ORDER BY position, stable_step_id`,
    )
    .bind(...(versionIds.length ? sqlIdSet(versionIds).binds : []))
    .all<ReminderVersionStepSummaryRow>();
  const stepsByVersion = new Map<string, ReminderVersionStepSummaryRow[]>();
  for (const step of steps.results) {
    const list = stepsByVersion.get(step.reminder_version_id) ?? [];
    list.push(step);
    stepsByVersion.set(step.reminder_version_id, list);
  }
  for (const row of rows) {
    const draftId = row.current_draft_version_id ?? null;
    const publishedId = row.current_published_version_id ?? null;
    const versionId = draftId ?? publishedId;
    if (!versionId) continue;
    const versionSteps = stepsByVersion.get(versionId) ?? [];
    const mode = row.delivery_mode === 'time' ? 'time' : 'countdown';
    const timing = versionSteps.length === 0
      ? '通知なし'
      : versionSteps
          .map((step) => describeReminderTiming(
            {
              offsetMinutes: step.offset_minutes,
              offsetDays: step.offset_days,
              sendAtTime: step.send_at_time,
            },
            mode,
          ))
          .join('・');
    const versionMark = draftId && publishedId ? '下書き: ' : '';
    summaries.set(row.id, {
      stepCount: versionSteps.length,
      timingSummary: `${versionMark}${timing} ／ テキスト ${versionSteps.length}通`,
    });
  }
  return summaries;
}

export function escapedLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export /*
 * N-072: 一覧の並び順。画面の `sort` 値をここで列へ写す。
 * 画面から来た文字列をそのまま ORDER BY へ入れない（SQL 注入になるので、
 * 白名簿以外は 400 で止める）。
 */
const REMINDER_LIST_SORTS: Record<string, { orderBy: string; meta: ReadonlyArray<{ field: string; direction: 'asc' | 'desc' }> }> = {
  order: {
    orderBy: 'r.display_order ASC, r.created_at DESC, r.id ASC',
    meta: [
      { field: 'displayOrder', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
  },
  next: {
    orderBy: `CASE WHEN EXISTS (
                SELECT 1 FROM reminder_delivery_runs upcoming
                WHERE upcoming.reminder_id = r.id
                  AND upcoming.status IN ('queued', 'retry_wait')
              ) THEN 0 ELSE 1 END,
              (SELECT MIN(upcoming.scheduled_at) FROM reminder_delivery_runs upcoming
               WHERE upcoming.reminder_id = r.id
                 AND upcoming.status IN ('queued', 'retry_wait')),
              r.id ASC`,
    meta: [
      { field: 'nextScheduledAt', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ],
  },
  created: {
    orderBy: 'r.created_at DESC, r.id ASC',
    meta: [
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
  },
  updated: {
    orderBy: 'r.updated_at DESC, r.id ASC',
    meta: [
      { field: 'updatedAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
  },
  name: {
    orderBy: 'LOWER(r.name) ASC, r.id ASC',
    meta: [
      { field: 'name', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ],
  },
};

export function runDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export type TriggerType = (typeof TRIGGER_TYPES)[number];

export /*
 * N-067: 手動登録の二重防止。通信再送・二重押下・応答不明でも、同じ手動
 * 登録から reminders を2行作らない。キーなしの従来呼び出しは変えない。
 *
 * 保証（キー付き経路）:
 * - 同一key＋同一内容→同じID・同じ応答、reminders・予約は1組だけ
 * - 同一key＋別内容→409（上書きしない）
 * - keyはaccountごとに名前空間を分け、別accountの同じkeyとは分離する
 * - 予約後・登録前の失敗は in_progress のまま残し、成功扱いに固定しない。
 *   再送は同じ束を通って回収する
 * - 同時押下はIDをkeyから決めるため何回通っても1行に収まる
 */
async function reminderIdForKey(namespacedKey: string): Promise<string> {
  const hex = await hashOutboundPayload(namespacedKey);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function createReminderIdempotent(
  db: D1Database,
  args: {
    lineAccountId: string;
    name: string;
    description?: string;
    trigger: Record<string, unknown>;
    requestKey: string;
  },
): Promise<{ status: 201 | 409; body: unknown }> {
  // 衝突判定は保存される値だけを正規化する。account・きっかけの決め方・
  // 対象・版（フォルダ）を含め、保存に影響しない余分は入れない。
  const normalized = {
    lineAccountId: args.lineAccountId,
    name: args.name,
    description: args.description ?? null,
    triggerType: args.trigger.triggerType ?? 'manual',
    triggerOffsetMinutes: args.trigger.triggerOffsetMinutes ?? null,
    sendAtTime: args.trigger.sendAtTime ?? null,
    targetTagId: args.trigger.targetTagId ?? null,
    deliveryMode: args.trigger.deliveryMode ?? null,
    triggerFieldId: args.trigger.triggerFieldId ?? null,
    repeatYearly: args.trigger.repeatYearly ?? false,
    folderId: args.trigger.folderId ?? null,
  };
  const namespacedKey = `reminder:${args.lineAccountId}:${args.requestKey}`;
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
    const existing = await getReminderById(db, reservation.responseId);
    if (existing) {
      return {
        status: 201,
        body: { success: true, data: { id: existing.id, name: existing.name, createdAt: existing.created_at } },
      };
    }
    // 成功確定のはずが行方不明。下の束で作り直す（INSERT OR IGNORE のため安全）。
  }
  const reminderId = await reminderIdForKey(namespacedKey);
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO reminders
         (id, name, description, trigger_type, trigger_offset_minutes,
          send_at_time, target_tag_id, delivery_mode,
          trigger_field_id, repeat_yearly, leap_year_policy, folder_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      reminderId,
      args.name,
      args.description ?? null,
      (args.trigger.triggerType as string) ?? 'manual',
      (args.trigger.triggerOffsetMinutes as number | null) ?? null,
      (args.trigger.sendAtTime as string | null) ?? null,
      (args.trigger.targetTagId as string | null) ?? null,
      (args.trigger.deliveryMode as string) ?? 'countdown',
      (args.trigger.triggerFieldId as string | null) ?? null,
      args.trigger.repeatYearly ? 1 : 0,
      (args.trigger.leapYearPolicy as 'feb28' | 'mar1' | 'skip' | null) ?? 'feb28',
      (args.trigger.folderId as string | null) ?? null,
      now,
      now,
    ),
    db.prepare(`UPDATE reminders SET line_account_id = ? WHERE id = ?`).bind(args.lineAccountId, reminderId),
    completeOutboundSendStatement(db, { key: namespacedKey, responseId: reminderId, now }),
  ]);
  const created = await getReminderById(db, reminderId);
  if (!created) throw new Error('reminder idempotency recovery failed');
  return {
    status: 201,
    body: { success: true, data: { id: created.id, name: created.name, createdAt: created.created_at } },
  };
}

export async function validateReminderFolder(
  db: D1Database,
  folderId: unknown,
): Promise<string | null> {
  if (folderId === null || folderId === '' || folderId === undefined) return null;
  if (typeof folderId !== 'string') return 'folderId must be a string';
  const folder = await getFolderById(db, folderId);
  if (!folder) return 'フォルダが見つかりません';
  if (folder.kind !== 'reminder') return 'リマインダ用ではないフォルダは選べません';
  return null;
}

export /**
 * きっかけの設定を検証して取り出す。送られた項目だけを含める。
 *
 * PUT は本文をそのまま updateReminder へ渡す作りだったので、
 * 新しい項目はここで形を確かめてから渡す。
 */
function readTriggerInput(
  body: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('triggerType')) {
    if (!TRIGGER_TYPES.includes(body.triggerType as TriggerType)) {
      return { ok: false, error: `triggerType must be one of ${TRIGGER_TYPES.join(', ')}` };
    }
    out.triggerType = body.triggerType;
  }
  if (has('triggerFieldId')) {
    const raw = body.triggerFieldId;
    if (raw === null || raw === '' || raw === undefined) {
      out.triggerFieldId = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, error: 'triggerFieldId must be a string' };
    } else {
      out.triggerFieldId = raw;
    }
  }
  if (has('triggerEventId')) {
    const raw = body.triggerEventId;
    if (raw === null || raw === '' || raw === undefined) {
      out.triggerEventId = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, error: 'triggerEventId must be a string' };
    } else {
      out.triggerEventId = raw;
    }
  }
  if (has('repeatYearly')) {
    if (typeof body.repeatYearly !== 'boolean') {
      return { ok: false, error: 'repeatYearly must be boolean' };
    }
    out.repeatYearly = body.repeatYearly;
  }
  if (has('leapYearPolicy')) {
    const raw = body.leapYearPolicy;
    if (raw === null || raw === undefined) {
      out.leapYearPolicy = 'feb28';
    } else if (!(LEAP_YEAR_POLICIES as readonly string[]).includes(raw as string)) {
      return { ok: false, error: `leapYearPolicy must be one of ${LEAP_YEAR_POLICIES.join(', ')}` };
    } else {
      out.leapYearPolicy = raw as 'feb28' | 'mar1' | 'skip';
    }
  }
  if (has('deliveryMode')) {
    if (!DELIVERY_MODES.includes(body.deliveryMode as (typeof DELIVERY_MODES)[number])) {
      return { ok: false, error: `deliveryMode must be one of ${DELIVERY_MODES.join(', ')}` };
    }
    out.deliveryMode = body.deliveryMode;
  }
  if (has('triggerOffsetMinutes')) {
    const raw = body.triggerOffsetMinutes;
    if (raw === null || raw === '' || raw === undefined) {
      out.triggerOffsetMinutes = null;
    } else {
      const n = Number(raw);
      // 前にも後ろにもずらせるので負の値を許す。上限は前後30日。
      if (!Number.isInteger(n) || Math.abs(n) > 60 * 24 * 30) {
        return { ok: false, error: 'triggerOffsetMinutes must be an integer within +/- 43200' };
      }
      out.triggerOffsetMinutes = n;
    }
  }
  if (has('sendAtTime')) {
    const raw = body.sendAtTime;
    if (raw === null || raw === '' || raw === undefined) {
      out.sendAtTime = null;
    } else if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
      return { ok: false, error: 'sendAtTime must be HH:MM' };
    } else {
      out.sendAtTime = raw;
    }
  }
  if (has('targetTagId')) {
    const raw = body.targetTagId;
    out.targetTagId = raw === null || raw === '' || raw === undefined ? null : String(raw);
  }
  // 156: フォルダ。空文字は「未分類へ戻す」として扱う。画面の select は
  // 未分類を空の値で出すので、そこを null に読み替える。
  if (has('folderId')) {
    const raw = body.folderId;
    out.folderId = raw === null || raw === '' || raw === undefined ? null : String(raw);
  }
  return { ok: true, value: out };
}

export const REMINDER_MESSAGE_TYPES = new Set([
  'text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel',
]);

export /**
 * 対象の絞り込み条件を読む。保存してよい形かもここで見る。
 *
 * 組み立てを実際に走らせ、例外が出たら 422 で止める。形だけ見ると、
 * 保存はできるのに数え直し・登録で落ちる条件が作れてしまう。
 * 空 (rules・groups ともに0件) は「条件なし」として null に倒す。
 */
function readTargetCondition(
  raw: unknown,
): { ok: true; value: ReminderDraftSettings['targetCondition'] } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '対象の条件の形が正しくありません' };
  }
  const condition = raw as { operator?: unknown; rules?: unknown; groups?: unknown };
  if (condition.operator !== 'AND' && condition.operator !== 'OR') {
    return { ok: false, error: '対象の条件は operator に AND / OR が要ります' };
  }
  if (!Array.isArray(condition.rules)) {
    return { ok: false, error: '対象の条件は rules の配列が要ります' };
  }
  if (condition.groups !== undefined && !Array.isArray(condition.groups)) {
    return { ok: false, error: '対象の条件は groups の配列が要ります' };
  }
  const groups = Array.isArray(condition.groups) ? condition.groups : [];
  if (condition.rules.length === 0 && groups.length === 0) {
    return { ok: true, value: null };
  }
  try {
    buildPublicSegmentQuery(condition as never);
  } catch (err) {
    return { ok: false, error: `対象の条件を読めません: ${(err as Error).message}` };
  }
  return {
    ok: true,
    value: condition as ReminderDraftSettings['targetCondition'],
  };
}
