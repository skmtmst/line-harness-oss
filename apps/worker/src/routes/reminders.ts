import { Hono, type Context } from 'hono';
import {
  getReminders,
  reorderReminders,
  getReminderById,
  createReminder,
  updateReminder,
  deleteReminder,
  getReminderSteps,
  createReminderStep,
  deleteReminderStep,
  enrollFriendInReminder,
  getFriendReminders,
  cancelFriendReminder,
  getFolderById,
  getReminderDeliveryRunById,
  getReminderDeliveryRunSummary,
  getReminderDeliveryStepSummaries,
  listReminderDeliveryRuns,
  retryReminderDeliveryRun,
  getReminderDraftVersion,
  getReminderPublishedVersion,
  createReminderWithDraftVersion,
  parseReminderVersionSettings,
  saveReminderDraftVersion,
  recordReminderDraftTest,
  publishReminderDraftVersion,
  type ReminderDraftSettings,
  type ReminderVersionRow,
  type ReminderDeliveryRunStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import {
  previewReminderDraft,
  testReminderDraft,
  validateReminderDraft,
} from '../services/reminder-draft.js';

const reminders = new Hono<Env>();

async function requireVisibleReminder(c: Context<Env>, next: () => Promise<void>) {
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

const TRIGGER_TYPES = ['manual', 'booking', 'event', 'friend_field'] as const;
const DELIVERY_MODES = ['time', 'countdown'] as const;
const RUN_STATUSES: ReminderDeliveryRunStatus[] = [
  'planned', 'claimed', 'succeeded', 'skipped',
  'retry_wait', 'permanent_failed', 'cancelled',
];

function commonRunStatus(status: ReminderDeliveryRunStatus) {
  if (status === 'succeeded') return 'succeeded' as const;
  if (status === 'permanent_failed') return 'failed' as const;
  if (status === 'skipped') return 'skipped' as const;
  if (status === 'cancelled') return 'cancelled' as const;
  return 'pending' as const;
}

function runDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}
type TriggerType = (typeof TRIGGER_TYPES)[number];

async function validateReminderFolder(
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

/**
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
  if (has('repeatYearly')) {
    if (typeof body.repeatYearly !== 'boolean') {
      return { ok: false, error: 'repeatYearly must be boolean' };
    }
    out.repeatYearly = body.repeatYearly;
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

const MESSAGE_TYPES = ['text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel'] as const;

function readDraftSettings(
  raw: unknown,
): { ok: true; value: ReminderDraftSettings } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '下書きの内容が正しくありません' };
  }
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const lineAccountId = typeof body.lineAccountId === 'string' ? body.lineAccountId.trim() : '';
  if (!name) return { ok: false, error: 'リマインダ名を入力してください' };
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
    const offsetDays = step.offsetDays === null || step.offsetDays === undefined
      ? null : Number(step.offsetDays);
    const sendAtTime = step.sendAtTime === null || step.sendAtTime === undefined || step.sendAtTime === ''
      ? null : String(step.sendAtTime);
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
    if (!MESSAGE_TYPES.includes(messageType as (typeof MESSAGE_TYPES)[number])) {
      return { ok: false, error: '送る内容の種類が正しくありません' };
    }
    steps.push({
      stableStepId,
      offsetMinutes,
      messageType,
      messageContent: typeof step.messageContent === 'string' ? step.messageContent : '',
      offsetDays,
      sendAtTime,
      templateId: typeof step.templateId === 'string' && step.templateId ? step.templateId : null,
      targetCondition: step.targetCondition && typeof step.targetCondition === 'object'
        ? step.targetCondition as Record<string, unknown> : {},
      action: step.action && typeof step.action === 'object'
        ? step.action as Record<string, unknown> : {},
    });
  }
  const stop = body.stopConditions && typeof body.stopConditions === 'object'
    ? body.stopConditions as Record<string, unknown> : {};
  const daysAfterTarget = stop.daysAfterTarget === null || stop.daysAfterTarget === undefined
    ? null : Number(stop.daysAfterTarget);
  if (daysAfterTarget !== null && (!Number.isInteger(daysAfterTarget) || daysAfterTarget < 0 || daysAfterTarget > 365)) {
    return { ok: false, error: '自動終了日は0〜365日で指定してください' };
  }
  const triggerOffsetMinutes = body.triggerOffsetMinutes === null || body.triggerOffsetMinutes === undefined
    ? null : Number(body.triggerOffsetMinutes);
  if (
    triggerOffsetMinutes !== null
    && (!Number.isInteger(triggerOffsetMinutes) || Math.abs(triggerOffsetMinutes) > 60 * 24 * 30)
  ) {
    return { ok: false, error: '基準日からのずらし方は前後30日以内で指定してください' };
  }
  const sendAtTime = typeof body.sendAtTime === 'string' && body.sendAtTime ? body.sendAtTime : null;
  if (sendAtTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendAtTime)) {
    return { ok: false, error: '送る時刻はHH:MMで指定してください' };
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
      repeatYearly: body.repeatYearly === true,
      triggerOffsetMinutes,
      sendAtTime,
      targetTagId: typeof body.targetTagId === 'string' && body.targetTagId ? body.targetTagId : null,
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

async function validateReminderDraftReferences(
  db: D1Database,
  settings: ReminderDraftSettings,
): Promise<string | null> {
  if (settings.targetTagId) {
    const tag = await db.prepare(
      `SELECT id FROM tags
        WHERE id = ? AND (line_account_id = ? OR line_account_id IS NULL)`,
    ).bind(settings.targetTagId, settings.lineAccountId).first<{ id: string }>();
    if (!tag) return '対象タグが見つかりません';
  }
  if (settings.triggerFieldId) {
    const field = await db.prepare('SELECT id FROM friend_fields WHERE id = ?')
      .bind(settings.triggerFieldId)
      .first<{ id: string }>();
    if (!field) return '基準日に使う友だち情報欄が見つかりません';
  }
  return null;
}

function versionResponse(row: ReminderVersionRow) {
  return {
    reminderId: row.reminder_id,
    versionId: row.id,
    versionNumber: Number(row.version_number),
    status: row.status,
    settings: parseReminderVersionSettings(row),
    lastTestStatus: row.last_test_status,
    lastTestedAt: row.last_tested_at,
    publishedAt: row.published_at,
  };
}


// ========== リマインダCRUD ==========

/**
 * PATCH /api/reminders/reorder — 並び順をまとめて書く。
 *
 * 経路が /api/reminders/:id より前にあるのは、:id に "reorder" として
 * 吸われるのを避けるため（シナリオと同じ並べ方）。
 */
reminders.patch('/api/reminders/reorder', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ ids?: unknown }>();
    if (!Array.isArray(body.ids) || body.ids.some((v) => typeof v !== 'string')) {
      return c.json({ success: false, error: 'ids must be an array of reminder ids' }, 400);
    }
    if (body.ids.length > 500) {
      return c.json({ success: false, error: 'too many ids' }, 400);
    }
    await reorderReminders(c.env.DB, body.ids as string[]);
    return c.json({ success: true, data: { updated: body.ids.length } });
  } catch (err) {
    console.error('PATCH /api/reminders/reorder error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/reminders', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let items: Awaited<ReturnType<typeof getReminders>>;
    if (lineAccountId) {
      /*
       * 並びは getReminders() と同じにする（161）。
       *
       * ここだけ created_at DESC のままだと、**画面から並べ替えても効かない。**
       * アカウントを選んでいるのが通常の状態（選択は既定で先頭のアカウントに
       * 入る）なので、効かないほうが既定になっていた。
       */
      const result = await c.env.DB
        .prepare(
          `SELECT * FROM reminders WHERE line_account_id = ? AND deleted_at IS NULL
            ORDER BY display_order ASC, created_at DESC`,
        )
        .bind(lineAccountId)
        .all();
      items = result.results as unknown as Awaited<ReturnType<typeof getReminders>>;
    } else {
      items = await getReminders(c.env.DB);
    }
    /*
     * 通の数を1回のクエリでまとめて数える。
     *
     * 一覧に「何通持っているか」を出すため。リマインダごとに
     * /api/reminders/:id を叩くと、20件で20回になる。
     * 1つも無いリマインダは行が返らないので、既定を0にする。
     */
    const counts = await c.env.DB
      .prepare(
        `SELECT r.id AS reminder_id,
                CASE WHEN r.current_published_version_id IS NOT NULL
                  THEN COUNT(rvs.id)
                  ELSE (SELECT COUNT(*) FROM reminder_steps rs WHERE rs.reminder_id = r.id)
                END AS c
           FROM reminders r
           LEFT JOIN reminder_version_steps rvs
             ON rvs.reminder_version_id = r.current_published_version_id
          GROUP BY r.id`,
      )
      .all<{ reminder_id: string; c: number }>();
    const stepCounts = new Map(counts.results.map((row) => [row.reminder_id, Number(row.c)]));

    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: Boolean(r.is_active),
        lifecycleStatus: r.lifecycle_status ?? (r.is_active ? 'published' : 'stopped'),
        currentDraftVersionId: r.current_draft_version_id ?? null,
        currentPublishedVersionId: r.current_published_version_id ?? null,
        triggerType: r.trigger_type ?? 'manual',
        deliveryMode: r.delivery_mode ?? 'countdown',
        triggerFieldId: r.trigger_field_id ?? null,
        repeatYearly: r.repeat_yearly === 1,
        triggerOffsetMinutes: r.trigger_offset_minutes ?? null,
        sendAtTime: r.send_at_time ?? null,
        targetTagId: r.target_tag_id ?? null,
        folderId: r.folder_id ?? null,
        stepCount: stepCounts.get(r.id) ?? 0,
        displayOrder: r.display_order ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** V6: 公開前の設定だけを作る。作成時点では配信対象にしない。 */
reminders.post('/api/reminders/drafts', requireRole('owner', 'admin'), async (c) => {
  try {
    const parsed = readDraftSettings(await c.req.json());
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [parsed.value.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const folderError = await validateReminderFolder(c.env.DB, parsed.value.folderId);
    if (folderError) return c.json({ success: false, error: folderError }, 422);
    const referenceError = await validateReminderDraftReferences(c.env.DB, parsed.value);
    if (referenceError) return c.json({ success: false, error: referenceError }, 422);
    const created = await createReminderWithDraftVersion(c.env.DB, parsed.value);
    return c.json({ success: true, data: versionResponse(created.version) }, 201);
  } catch (err) {
    console.error('POST /api/reminders/drafts error:', err);
    return c.json({ success: false, error: '下書きを作成できませんでした' }, 500);
  }
});

reminders.use('/api/reminders/:id', requireVisibleReminder);
reminders.use('/api/reminders/:id/*', requireVisibleReminder);
reminders.get('/api/reminders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const [reminder, steps] = await Promise.all([
      getReminderById(c.env.DB, id),
      getReminderSteps(c.env.DB, id),
    ]);
    if (!reminder) return c.json({ success: false, error: 'Reminder not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: reminder.id,
        name: reminder.name,
        description: reminder.description,
        isActive: Boolean(reminder.is_active),
        lifecycleStatus: reminder.lifecycle_status ?? (reminder.is_active ? 'published' : 'stopped'),
        currentDraftVersionId: reminder.current_draft_version_id ?? null,
        currentPublishedVersionId: reminder.current_published_version_id ?? null,
        triggerType: reminder.trigger_type ?? 'manual',
        deliveryMode: reminder.delivery_mode ?? 'countdown',
        triggerFieldId: reminder.trigger_field_id ?? null,
        repeatYearly: reminder.repeat_yearly === 1,
        triggerOffsetMinutes: reminder.trigger_offset_minutes ?? null,
        sendAtTime: reminder.send_at_time ?? null,
        targetTagId: reminder.target_tag_id ?? null,
        folderId: reminder.folder_id ?? null,
        createdAt: reminder.created_at,
        updatedAt: reminder.updated_at,
        steps: steps.map((s) => ({
          id: s.id,
          reminderId: s.reminder_id,
          offsetMinutes: s.offset_minutes,
          messageType: s.message_type,
          messageContent: s.message_content,
          offsetDays: s.offset_days,
          sendAtTime: s.send_at_time,
          templateId: s.template_id,
          createdAt: s.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/reminders/:id/draft', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const version = await getReminderDraftVersion(c.env.DB, id)
      ?? await getReminderPublishedVersion(c.env.DB, id);
    if (!version) return c.json({ success: false, error: '下書きが見つかりません' }, 404);
    return c.json({ success: true, data: versionResponse(version) });
  } catch (err) {
    console.error('GET /api/reminders/:id/draft error:', err);
    return c.json({ success: false, error: '下書きを読み込めませんでした' }, 500);
  }
});

reminders.put('/api/reminders/:id/draft', requireRole('owner', 'admin'), async (c) => {
  try {
    const parsed = readDraftSettings(await c.req.json());
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [parsed.value.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const folderError = await validateReminderFolder(c.env.DB, parsed.value.folderId);
    if (folderError) return c.json({ success: false, error: folderError }, 422);
    const referenceError = await validateReminderDraftReferences(c.env.DB, parsed.value);
    if (referenceError) return c.json({ success: false, error: referenceError }, 422);
    const version = await saveReminderDraftVersion(c.env.DB, c.req.param('id'), parsed.value);
    return c.json({ success: true, data: versionResponse(version) });
  } catch (err) {
    console.error('PUT /api/reminders/:id/draft error:', err);
    return c.json({ success: false, error: '下書きを保存できませんでした' }, 500);
  }
});

reminders.post('/api/reminders/:id/validate', requireRole('owner', 'admin'), async (c) => {
  try {
    const version = await getReminderDraftVersion(c.env.DB, c.req.param('id'));
    if (!version) return c.json({ success: false, error: '公開する下書きがありません' }, 404);
    const result = await validateReminderDraft(c.env.DB, parseReminderVersionSettings(version), version);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('POST /api/reminders/:id/validate error:', err);
    return c.json({ success: false, error: '公開前チェックを実行できませんでした' }, 500);
  }
});

reminders.post('/api/reminders/:id/preview', requireRole('owner', 'admin'), async (c) => {
  try {
    const version = await getReminderDraftVersion(c.env.DB, c.req.param('id'))
      ?? await getReminderPublishedVersion(c.env.DB, c.req.param('id'));
    if (!version) return c.json({ success: false, error: '確認する設定がありません' }, 404);
    const body: { targetDate?: string } = await c.req
      .json<{ targetDate?: string }>()
      .catch(() => ({}));
    const targetDate = body.targetDate
      ? new Date(body.targetDate)
      : new Date(Date.now() + 7 * 86_400_000);
    if (Number.isNaN(targetDate.getTime())) {
      return c.json({ success: false, error: '基準日の形式が正しくありません' }, 400);
    }
    const result = await previewReminderDraft(c.env.DB, parseReminderVersionSettings(version), targetDate);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('POST /api/reminders/:id/preview error:', err);
    return c.json({ success: false, error: '配信予定を確認できませんでした' }, 500);
  }
});

reminders.post('/api/reminders/:id/test-send', requireRole('owner', 'admin'), async (c) => {
  let version: ReminderVersionRow | null = null;
  try {
    const requestKey = c.req.header('Idempotency-Key');
    if (!isValidIdempotencyKey(requestKey)) {
      return c.json({ success: false, error: 'テスト送信キーが必要です' }, 400);
    }
    version = await getReminderDraftVersion(c.env.DB, c.req.param('id'));
    if (!version) return c.json({ success: false, error: 'テストする下書きがありません' }, 404);
    const result = await testReminderDraft(
      c.env.DB,
      version,
      parseReminderVersionSettings(version),
      requestKey,
    );
    await recordReminderDraftTest(c.env.DB, version.id, { succeeded: true, staffId: c.get('staff')?.id ?? null });
    return c.json({ success: true, data: result });
  } catch (err) {
    if (version) {
      await recordReminderDraftTest(c.env.DB, version.id, { succeeded: false, staffId: c.get('staff')?.id ?? null });
    }
    const code = err instanceof Error ? err.message : '';
    const message = code === 'REMINDER_TEST_RECIPIENT_NOT_CONFIGURED'
      ? 'テスト送信先を設定してください'
      : code === 'REMINDER_TEST_RECIPIENT_NOT_AVAILABLE'
        ? 'テスト送信先のLINE連携を確認してください'
        : code === 'REMINDER_TEST_STEP_NOT_FOUND'
          ? '送る通知を1件以上追加してください'
          : code === 'REMINDER_TEST_KEY_CONFLICT'
            ? '同じ送信キーが別の内容で使われています'
            : 'テスト送信できませんでした。LINE連携と送る内容を確認してください。';
    console.error('POST /api/reminders/:id/test-send error:', err);
    return c.json({ success: false, error: message }, code === 'REMINDER_TEST_KEY_CONFLICT' ? 409 : 422);
  }
});

reminders.post('/api/reminders/:id/publish', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const version = await getReminderDraftVersion(c.env.DB, id);
    if (!version) return c.json({ success: false, error: '公開する下書きがありません' }, 404);
    const settings = parseReminderVersionSettings(version);
    const validation = await validateReminderDraft(c.env.DB, settings, version);
    if (!validation.valid) {
      return c.json({ success: false, error: '公開前チェックに未完了があります', data: validation }, 422);
    }
    const published = await publishReminderDraftVersion(c.env.DB, id, c.get('staff')?.id ?? null);
    const preview = await previewReminderDraft(c.env.DB, settings, new Date(Date.now() + 7 * 86_400_000));
    const next = preview.items
      .filter((item) => item.state === 'scheduled')
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]?.scheduledAt ?? null;
    return c.json({
      success: true,
      data: {
        reminderId: id,
        versionId: published.id,
        versionNumber: Number(published.version_number),
        publishedAt: published.published_at,
        audience: validation.audience.matched,
        plannedDeliveries: preview.summary.next30Days,
        nextScheduledAt: next,
      },
    });
  } catch (err) {
    console.error('POST /api/reminders/:id/publish error:', err);
    return c.json({ success: false, error: 'リマインダを有効化できませんでした' }, 500);
  }
});

/** V6 7-1-H: 予定・成功・失敗を、未取得と0件を混ぜずに返す。 */
reminders.get('/api/reminders/:id/runs', async (c) => {
  try {
    const reminderId = c.req.param('id');
    const reminder = await getReminderById(c.env.DB, reminderId);
    const accountId = reminder
      ? (reminder as { line_account_id?: string | null }).line_account_id ?? null
      : null;
    // ルート共通middlewareに加え、個人名を返す口でも親リマインダの範囲を明示確認する。
    if (!reminder || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Reminder not found' }, 404);
    }

    const rawStatus = c.req.query('status');
    const status = rawStatus && RUN_STATUSES.includes(rawStatus as ReminderDeliveryRunStatus)
      ? rawStatus as ReminderDeliveryRunStatus
      : undefined;
    if (rawStatus && !status) {
      return c.json({ success: false, error: 'statusの値が正しくありません' }, 400);
    }
    const rawLimit = Number(c.req.query('limit') ?? 20);
    const rawOffset = Number(c.req.query('offset') ?? 0);
    const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 20;
    const offset = Number.isInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
    const search = c.req.query('search')?.trim().slice(0, 100) || undefined;

    const [runs, summary, stepRows] = await Promise.all([
      listReminderDeliveryRuns(c.env.DB, { reminderId, status, search, limit, offset }),
      getReminderDeliveryRunSummary(c.env.DB, reminderId),
      getReminderDeliveryStepSummaries(c.env.DB, reminderId),
    ]);
    return c.json({
      success: true,
      data: {
        reminder: { id: reminder.id, name: reminder.name, isActive: Boolean(reminder.is_active) },
        summary,
        steps: stepRows.map((row, index) => ({
          id: row.id,
          stepNumber: index + 1,
          offsetMinutes: row.offset_minutes,
          messageType: row.message_type,
          messageContent: row.message_content,
          sent: row.sent,
          // LINE Messaging APIは友だち単位の既読を返さない。0%を作らない。
          openRate: null,
          errors: row.errors,
        })),
        items: runs.items.map((row) => ({
          id: row.id,
          ownerKind: 'reminder' as const,
          ownerId: row.reminder_id,
          lineAccountId: row.line_account_id,
          occurredAt: row.completed_at ?? row.started_at ?? row.scheduled_at,
          subject: row.friend_name,
          accountLabel: row.account_label,
          triggerLabel: reminder.name,
          reference: null,
          status: commonRunStatus(row.status),
          detail: row.last_error_message ?? `${Number(row.step_number)}通目`,
          durationMs: runDurationMs(row.started_at, row.completed_at),
          canRetry: row.status === 'retry_wait' || row.status === 'permanent_failed',
          reminderId: row.reminder_id,
          friendReminderId: row.friend_reminder_id,
          friendId: row.friend_id,
          friendName: row.friend_name,
          reminderStepId: row.reminder_step_id,
          stepNumber: Number(row.step_number),
          scheduledAt: row.scheduled_at,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          domainStatus: row.status,
          attemptCount: Number(row.attempt_count),
          nextRetryAt: row.next_retry_at,
          lastErrorCode: row.last_error_code,
          lastErrorMessage: row.last_error_message,
          lineRequestId: row.line_request_id,
          messageLogId: row.message_log_id,
        })),
        pagination: { total: runs.total, limit, offset },
      },
    });
  } catch (err) {
    console.error('GET /api/reminders/:id/runs error:', err);
    return c.json({ success: false, error: '実行結果を読み込めませんでした' }, 500);
  }
});

reminders.post('/api/reminders', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      lineAccountId?: string | null;
    } & Record<string, unknown>>();
    if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
    if (typeof body.lineAccountId !== 'string' || !body.lineAccountId.trim()) {
      return c.json({ success: false, error: 'LINEアカウントを選んでください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const trigger = readTriggerInput(body);
    if (!trigger.ok) return c.json({ success: false, error: trigger.error }, 400);
    const folderError = await validateReminderFolder(c.env.DB, trigger.value.folderId);
    if (folderError) return c.json({ success: false, error: folderError }, 422);
    const item = await createReminder(c.env.DB, { ...body, ...trigger.value });
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE reminders SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, name: item.name, createdAt: item.created_at } }, 201);
  } catch (err) {
    console.error('POST /api/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.put('/api/reminders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const trigger = readTriggerInput(body);
    if (!trigger.ok) return c.json({ success: false, error: trigger.error }, 400);
    const folderError = await validateReminderFolder(c.env.DB, trigger.value.folderId);
    if (folderError) return c.json({ success: false, error: folderError }, 422);
    await updateReminder(c.env.DB, id, { ...body, ...trigger.value });
    const updated = await getReminderById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/reminders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteReminder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== リマインダステップ ==========

reminders.post('/api/reminders/:id/steps', requireRole('owner', 'admin'), async (c) => {
  try {
    const reminderId = c.req.param('id');
    const body = await c.req.json<{
      offsetMinutes: number;
      messageType: string;
      messageContent: string;
      offsetDays?: number | null;
      sendAtTime?: string | null;
      templateId?: string | null;
    }>();
    if (body.offsetMinutes === undefined || !body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'offsetMinutes, messageType, messageContent are required' }, 400);
    }
    if (
      body.sendAtTime !== undefined &&
      body.sendAtTime !== null &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.sendAtTime)
    ) {
      return c.json({ success: false, error: 'sendAtTime must be HH:MM' }, 400);
    }
    if (
      body.offsetDays !== undefined &&
      body.offsetDays !== null &&
      (!Number.isInteger(body.offsetDays) || Math.abs(body.offsetDays) > 365)
    ) {
      return c.json({ success: false, error: 'offsetDays must be an integer within +/- 365' }, 400);
    }
    const step = await createReminderStep(c.env.DB, { reminderId, ...body });
    return c.json({
      success: true,
      data: {
        id: step.id,
        reminderId: step.reminder_id,
        offsetMinutes: step.offset_minutes,
        messageType: step.message_type,
        messageContent: step.message_content,
        offsetDays: step.offset_days,
        sendAtTime: step.send_at_time,
        templateId: step.template_id,
        createdAt: step.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/reminders/:id/steps error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/reminders/:reminderId/steps/:stepId', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteReminderStep(c.env.DB, c.req.param('stepId'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/reminders/:reminderId/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 友だちリマインダ登録 ==========

reminders.post('/api/reminders/:id/enroll/:friendId', requireRole('owner', 'admin'), async (c) => {
  try {
    const reminderId = c.req.param('id');
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ targetDate: string }>();
    if (!body.targetDate) return c.json({ success: false, error: 'targetDate is required' }, 400);
    const enrollment = await enrollFriendInReminder(c.env.DB, { friendId, reminderId, targetDate: body.targetDate });
    return c.json({
      success: true,
      data: { id: enrollment.id, friendId: enrollment.friend_id, reminderId: enrollment.reminder_id, targetDate: enrollment.target_date, status: enrollment.status },
    }, 201);
  } catch (err) {
    console.error('POST /api/reminders/:id/enroll/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/friends/:friendId/reminders', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const items = await getFriendReminders(c.env.DB, friendId);
    return c.json({
      success: true,
      data: items.map((fr) => ({
        id: fr.id,
        friendId: fr.friend_id,
        reminderId: fr.reminder_id,
        targetDate: fr.target_date,
        status: fr.status,
        createdAt: fr.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/friends/:friendId/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/friend-reminders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await cancelFriendReminder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friend-reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 失敗した1通だけを、同じ依頼の二重受付なしで再試行する。 */
reminders.post('/api/reminder-runs/:runId/retry', requireRole('owner', 'admin'), async (c) => {
  try {
    const run = await getReminderDeliveryRunById(c.env.DB, c.req.param('runId'));
    if (!run) return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
    const reminder = await getReminderById(c.env.DB, run.reminder_id);
    const accountId = reminder
      ? (reminder as { line_account_id?: string | null }).line_account_id ?? null
      : null;
    if (!reminder || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
    }

    const requestKey = c.req.header('Idempotency-Key');
    if (!isValidIdempotencyKey(requestKey)) {
      return c.json({ success: false, error: '再試行キーが必要です' }, 400);
    }
    const retried = await retryReminderDeliveryRun(c.env.DB, {
      id: run.id,
      requestKey,
      now: new Date().toISOString(),
    });
    if (!retried) return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
    if (retried.kind === 'conflict') {
      return c.json({ success: false, error: 'この実行は再試行できる状態ではありません' }, 409);
    }
    return c.json({
      success: true,
      data: { id: retried.run.id, status: retried.run.status, replayed: retried.kind === 'replay' },
    });
  } catch (err) {
    console.error('POST /api/reminder-runs/:runId/retry error:', err);
    return c.json({ success: false, error: '再試行を受け付けられませんでした' }, 500);
  }
});

export { reminders };
