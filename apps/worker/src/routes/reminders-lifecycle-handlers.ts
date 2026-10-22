import { clampedListInteger } from '../lib/list-paging.js';
import { inputError } from '../lib/input-errors.js';

import { getFriendById, getReminderById, createReminder, updateReminder, deleteReminder, restoreReminder, createReminderStep, deleteReminderStep, enrollFriendInReminder, getFriendReminders, listReminderRegistrants, moveReminderRegistrantTargetDate, cancelReminderRegistrant, resumeReminderRegistrant, getReminderRegistrantById, getReminderDeliveryRunById, getReminderDeliveryRunSummary, getReminderDeliveryStepSummaries, listReminderDeliveryRuns, retryReminderDeliveryRun, getReminderPublishedVersion, parseReminderVersionSettings, type ReminderDeliveryRunStatus } from '@line-crm/db';

import { REMINDER_NAME_MAX_LENGTH, REMINDER_NAME_TOO_LONG_MESSAGE } from '@line-crm/shared';
import type { Env } from '../worker-env.js';

import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import { RUN_STATUSES, commonRunStatus, runDurationMs, publicRunStatus, readTriggerInput, validateReminderFolder, createReminderIdempotent, REMINDER_MESSAGE_TYPES, publicRegistrant, canonicalTargetDate, isNonNegativeInteger, mutationResponse, buildResumeExpectedRuns } from './reminders-definition.js';
import type { Context } from 'hono';

export const get__api_reminders_id_runs_1 = async (c: Context<Env, "/api/reminders/:id/runs">) => {
  try {
    const reminderId = c.req.param('id');
    const reminder = await getReminderById(c.env.DB, reminderId);
    if (!reminder) {
      return c.json({ success: false, error: 'Reminder not found' }, 404);
    }
    const accountId = (reminder as { line_account_id?: string | null }).line_account_id ?? null;
    // R349: 個人名を返す口は、親の今の所属ではなく実行行の送信元
    // アカウントで絞る。所属変更前の履歴が担当外に漏れないようにする。
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const canSeeParent = await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]);

    const rawStatus = c.req.query('status');
    // 管理画面と共有契約は「配信予定」を planned と呼ぶ。DB の queued は
    // 配信処理だけの内部状態として保ち、API 境界で相互変換する。
    const status = rawStatus === 'planned'
      ? 'queued'
      : rawStatus && RUN_STATUSES.includes(rawStatus as ReminderDeliveryRunStatus)
        ? rawStatus as ReminderDeliveryRunStatus
        : undefined;
    if (rawStatus && !status) {
      return c.json({ success: false, error: 'statusの値が正しくありません' }, 400);
    }
    const order = c.req.query('order');
    const executedOnly = c.req.query('executedOnly');
    if ((order && !['scheduled_asc', 'recent_desc'].includes(order)) ||
        (executedOnly !== undefined && !['true', 'false'].includes(executedOnly))) {
      return c.json({ success: false, error: '取得条件が正しくありません' }, 400);
    }
    const limit = clampedListInteger(c.req.query('limit'), 20, 1, 100);
    const offset = clampedListInteger(c.req.query('offset'), 0, 0);
    const search = c.req.query('search')?.trim().slice(0, 100) || undefined;

    const [runs, summary, stepRows, publishedVersion] = await Promise.all([
      listReminderDeliveryRuns(c.env.DB, { reminderId, status, search, limit, offset, scope,
        ...(order ? { order: order as 'scheduled_asc' | 'recent_desc' } : {}),
        ...(executedOnly !== undefined ? { executedOnly: executedOnly === 'true' } : {}),
      }),
      getReminderDeliveryRunSummary(c.env.DB, reminderId, scope),
      getReminderDeliveryStepSummaries(c.env.DB, reminderId, scope),
      getReminderPublishedVersion(c.env.DB, reminderId),
    ]);
    // 見える行がなく親も見えないときは、あるなしを区別せず 404。
    if (runs.total === 0 && !canSeeParent) {
      return c.json({ success: false, error: 'Reminder not found' }, 404);
    }
    // 公開版のスナップショットが実際の停止条件。下書きや旧API由来の行で
    // 取れないときは null にし、画面側で「未取得」と区別する。
    const publishedSettings = publishedVersion ? parseReminderVersionSettings(publishedVersion) : null;
    return c.json({
      success: true,
      data: {
        reminder: {
          id: reminder.id,
          name: reminder.name,
          isActive: Boolean(reminder.is_active),
          lifecycleStatus: reminder.lifecycle_status,
          stopConditions: publishedSettings?.stopConditions ?? null,
          // R146 監査：公開版の有無を画面へ渡す。無い下書きは「停止中」と
          // 出さず「下書き」と出し、再開ボタンを出さない。
          hasPublishedVersion: publishedVersion !== null,
        },
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
          canRetry: (row.status === 'retry_wait' || row.status === 'permanent_failed')
            && !['delivery_started','delivery_unknown','retry_after_exceeds_budget'].includes(row.last_error_code ?? '')
            && (!row.next_retry_at || Date.parse(row.next_retry_at)<=Date.now())
            && !((['line_temporary_failure','delivery_failed','retry_key_expired','retry_exhausted'].includes(row.last_error_code ?? '')
              || row.last_error_code===null) && row.sent_message_content!==null),
          reminderId: row.reminder_id,
          friendReminderId: row.friend_reminder_id,
          friendId: row.friend_id,
          friendName: row.friend_name,
          reminderStepId: row.reminder_step_id,
          stepNumber: Number(row.step_number),
          scheduledAt: row.scheduled_at,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          domainStatus: publicRunStatus(row.status),
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
    throw err;
  }
};

export const post__api_reminders_2 = async (c: Context<Env, "/api/reminders">) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      lineAccountId?: string | null;
    } & Record<string, unknown>>();
    // N-078: 下書き保存と同じ規則で、前後空白を落としてから上限を数える。
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return inputError(c, { success: false, error: 'name is required' }, 400, ["name"]);
    if (name.length > REMINDER_NAME_MAX_LENGTH) {
      return inputError(c, { success: false, error: REMINDER_NAME_TOO_LONG_MESSAGE }, 422, ["name"]);
    }
    if (typeof body.lineAccountId !== 'string' || !body.lineAccountId.trim()) {
      return inputError(c, { success: false, error: 'LINEアカウントを選んでください' }, 400, ["lineAccountId"]);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const trigger = readTriggerInput(body);
    if (!trigger.ok) return inputError(c, { success: false, error: trigger.error }, 400, ["triggerType","triggerFieldId","triggerEventId","repeatYearly","leapYearPolicy","deliveryMode","triggerOffsetMinutes","sendAtTime","targetTagId","folderId"]);
    const folderError = await validateReminderFolder(c.env.DB, trigger.value.folderId);
    if (folderError) return inputError(c, { success: false, error: folderError }, 422, ["folderId"]);
    // N-067: Idempotency-Key 付きの登録は二重作成しない。キーなしは従来通り。
    const requestKey = c.req.header('Idempotency-Key')?.trim();
    if (requestKey !== undefined && requestKey !== '') {
      if (!isValidIdempotencyKey(requestKey)) {
        return inputError(c, { success: false, error: '有効なIdempotency-Keyが必要です' }, 400, []);
      }
      const result = await createReminderIdempotent(c.env.DB, {
        lineAccountId: body.lineAccountId.trim(),
        name,
        description: typeof body.description === 'string' ? body.description : undefined,
        trigger: trigger.value,
        requestKey,
      });
      return c.json(result.body, result.status);
    }
    const item = await createReminder(c.env.DB, { ...body, name, ...trigger.value });
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE reminders SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, name: item.name, createdAt: item.created_at } }, 201);
  } catch (err) {
    throw err;
  }
};

export const put__api_reminders_id_3 = async (c: Context<Env, "/api/reminders/:id">) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const trigger = readTriggerInput(body);
    if (!trigger.ok) return inputError(c, { success: false, error: trigger.error }, 400, ["triggerType","triggerFieldId","triggerEventId","repeatYearly","leapYearPolicy","deliveryMode","triggerOffsetMinutes","sendAtTime","targetTagId","folderId"]);
    /*
     * 送るタイミングの決め方は作成後に変えられない（画面にもそう書いてある）。
     * 変えると登録済みの配信予定がずれるので、変わっているときだけ422で止める。
     * 同じ値の再送は通す（画面のフォルダ移動などが同じ本文を送るため）。
     */
    if (Object.prototype.hasOwnProperty.call(body, 'triggerType')) {
      const current = await getReminderById(c.env.DB, id);
      if (!current) return c.json({ success: false, error: 'Not found' }, 404);
      if ((current.trigger_type ?? 'manual') !== trigger.value.triggerType) {
        return inputError(c, { success: false, error: '送るタイミングの決め方は作成後に変えられません' }, 422, ["triggerType","triggerFieldId","triggerEventId","repeatYearly","leapYearPolicy","deliveryMode","triggerOffsetMinutes","sendAtTime","targetTagId","folderId"]);
      }
    }
    const folderError = await validateReminderFolder(c.env.DB, trigger.value.folderId);
    if (folderError) return inputError(c, { success: false, error: folderError }, 422, ["folderId"]);
    // N-078: 名前の更新も作成と同じ上限で止める。画面の maxLength だけでは
    // API を直接叩かれたときに抜ける。
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return inputError(c, { success: false, error: 'リマインダ名を入力してください' }, 400, ["name"]);
      if (name.length > REMINDER_NAME_MAX_LENGTH) {
        return inputError(c, { success: false, error: REMINDER_NAME_TOO_LONG_MESSAGE }, 422, ["name"]);
      }
      body.name = name;
    }
    await updateReminder(c.env.DB, id, { ...body, ...trigger.value });
    const updated = await getReminderById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    // R146 監査：公開版の無い下書きの再開は 409 で止める。通すと公開版IDが
    // null のまま稼働中になり、公開版との状態が不整合になる。
    if (err instanceof Error && err.message === 'REMINDER_NOT_PUBLISHED') {
      return c.json({ success: false, error: 'まだ公開していない下書きは再開できません。先に公開してください' }, 409);
    }
    throw err;
  }
};

export const delete__api_reminders_id_4 = async (c: Context<Env, "/api/reminders/:id">) => {
  try {
    await deleteReminder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    throw err;
  }
};

export const post__api_reminders_id_restore_5 = async (c: Context<Env, "/api/reminders/:id/restore">) => {
  try {
    const restored = await restoreReminder(c.env.DB, c.req.param('id'));
    if (!restored) {
      return c.json({ success: false, error: 'Reminder not found' }, 404);
    }
    return c.json({
      success: true,
      data: { id: restored.id, name: restored.name, isActive: Boolean(restored.is_active) },
    });
  } catch (err) {
    throw err;
  }
};

export const post__api_reminders_id_steps_6 = async (c: Context<Env, "/api/reminders/:id/steps">) => {
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
      return inputError(c, { success: false, error: 'offsetMinutes, messageType, messageContent are required' }, 400, ["offsetMinutes","messageType","messageContent"]);
    }
    // 下書き側と同じ種類の一覧で検査する。巨大な本文や変な種類をDBへ入れない。
    if (!REMINDER_MESSAGE_TYPES.has(body.messageType)) {
      return inputError(c, { success: false, error: `messageType must be one of ${[...REMINDER_MESSAGE_TYPES].join(', ')}` }, 400, ["messageType"]);
    }
    if (typeof body.messageContent !== 'string' || !body.messageContent.trim()) {
      return inputError(c, { success: false, error: 'messageContent must not be empty' }, 400, ["messageContent"]);
    }
    if (body.messageContent.length > 5000) {
      return inputError(c, { success: false, error: 'messageContent must be at most 5000 characters' }, 400, ["messageContent"]);
    }
    if (
      body.sendAtTime !== undefined &&
      body.sendAtTime !== null &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.sendAtTime)
    ) {
      return inputError(c, { success: false, error: 'sendAtTime must be HH:MM' }, 400, ["sendAtTime"]);
    }
    if (
      body.offsetDays !== undefined &&
      body.offsetDays !== null &&
      (!Number.isInteger(body.offsetDays) || Math.abs(body.offsetDays) > 365)
    ) {
      return inputError(c, { success: false, error: 'offsetDays must be an integer within +/- 365' }, 400, ["offsetDays"]);
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
    throw err;
  }
};

export const delete__api_reminders_id_steps_stepId_7 = async (c: Context<Env, "/api/reminders/:id/steps/:stepId">) => {
  try {
    const deleted = await deleteReminderStep(c.env.DB, c.req.param('id'), c.req.param('stepId'));
    if (!deleted) {
      return c.json({ success: false, error: 'Reminder step not found' }, 404);
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    throw err;
  }
};

export const post__api_reminders_id_enroll_friendId_8 = async (c: Context<Env, "/api/reminders/:id/enroll/:friendId">) => {
  try {
    const reminderId = c.req.param('id');
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ targetDate: string }>();
    if (!body.targetDate) return inputError(c, { success: false, error: 'targetDate is required' }, 400, ["targetDate"]);
    // staff も通す分、担当外アカウントのリマインダ・友だちはここで隠す。
    const reminder = await getReminderById(c.env.DB, reminderId);
    const friend = await getFriendById(c.env.DB, friendId);
    const reminderAccountId = reminder
      ? (reminder as { line_account_id?: string | null }).line_account_id ?? null
      : null;
    const friendAccountId = friend
      ? ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null
      : null;
    if (!reminder || !friend || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [reminderAccountId, friendAccountId])) {
      return c.json({ success: false, error: 'Reminder or friend not found' }, 404);
    }
    const enrollment = await enrollFriendInReminder(c.env.DB, { friendId, reminderId, targetDate: body.targetDate });
    return c.json({
      success: true,
      data: { id: enrollment.id, friendId: enrollment.friend_id, reminderId: enrollment.reminder_id, targetDate: enrollment.target_date, status: enrollment.status },
    }, 201);
  } catch (err) {
    throw err;
  }
};

export const get__api_reminders_id_registrants_9 = async (c: Context<Env, "/api/reminders/:id/registrants">) => {
  try {
    // R348: 親の今の所属ではなく、友だちの所属が見える担当に出す。
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const items = await listReminderRegistrants(c.env.DB, c.req.param('id'), scope);
    if (items.length === 0) {
      const reminder = await getReminderById(c.env.DB, c.req.param('id'));
      const accountId = reminder
        ? (reminder as { line_account_id?: string | null }).line_account_id ?? null
        : null;
      // 見える行がなく親も見えないときは、あるなしを区別せず 404。
      if (!reminder || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
        return c.json({ success: false, error: 'Reminder not found' }, 404);
      }
    }
    return c.json({ success: true, data: items.map(publicRegistrant) });
  } catch (err) {
    throw err;
  }
};

export const patch__api_reminders_id_registrants_enrollmentId_10 = async (c: Context<Env, "/api/reminders/:id/registrants/:enrollmentId">) => {
  try {
    const body = await c.req.json<{ targetDate?: unknown; expectedLockVersion?: unknown }>();
    const targetDate = canonicalTargetDate(body.targetDate);
    if (!targetDate || !isNonNegativeInteger(body.expectedLockVersion)) {
      return inputError(c, { success: false, error: 'targetDate と expectedLockVersion を正しく指定してください' }, 400, ["targetDate","expectedLockVersion"]);
    }
    return mutationResponse(c, await moveReminderRegistrantTargetDate(c.env.DB, {
      reminderId: c.req.param('id'),
      enrollmentId: c.req.param('enrollmentId'),
      targetDate,
      expectedLockVersion: body.expectedLockVersion,
      scope: await getVisibleLineAccountScope(c.env.DB, c.get('staff')),
    }));
  } catch (err) {
    throw err;
  }
};

export const post__api_reminders_id_registrants_enrollmentId_cancel_11 = async (c: Context<Env, "/api/reminders/:id/registrants/:enrollmentId/cancel">) => {
  try {
    const body = await c.req.json<{ expectedLockVersion?: unknown }>();
    if (!isNonNegativeInteger(body.expectedLockVersion)) {
      return inputError(c, { success: false, error: 'expectedLockVersion を正しく指定してください' }, 400, ["expectedLockVersion"]);
    }
    return mutationResponse(c, await cancelReminderRegistrant(c.env.DB, {
      reminderId: c.req.param('id'),
      enrollmentId: c.req.param('enrollmentId'),
      expectedLockVersion: body.expectedLockVersion,
      cancelReason: 'manual_registration_cancelled',
      scope: await getVisibleLineAccountScope(c.env.DB, c.get('staff')),
    }));
  } catch (err) {
    throw err;
  }
};

export const post__api_reminders_id_registrants_enrollmentId_resume_12 = async (c: Context<Env, "/api/reminders/:id/registrants/:enrollmentId/resume">) => {
  try {
    const body = await c.req.json<{ expectedLockVersion?: unknown }>();
    if (!isNonNegativeInteger(body.expectedLockVersion)) {
      return inputError(c, { success: false, error: 'expectedLockVersion を正しく指定してください' }, 400, ["expectedLockVersion"]);
    }
    const expectedRuns = await buildResumeExpectedRuns(
      c.env.DB,
      c.req.param('id'),
      c.req.param('enrollmentId'),
      new Date(),
      await getVisibleLineAccountScope(c.env.DB, c.get('staff')),
    );
    return mutationResponse(c, await resumeReminderRegistrant(c.env.DB, {
      reminderId: c.req.param('id'),
      enrollmentId: c.req.param('enrollmentId'),
      expectedLockVersion: body.expectedLockVersion,
      expectedRuns,
      scope: await getVisibleLineAccountScope(c.env.DB, c.get('staff')),
    }));
  } catch (err) {
    throw err;
  }
};

export const get__api_friends_friendId_reminders_13 = async (c: Context<Env, "/api/friends/:friendId/reminders">) => {
  try {
    const friendId = c.req.param('friendId');
    const friend = await getFriendById(c.env.DB, friendId);
    const accountId = friend
      ? ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null
      : null;
    if (!friend || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
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
    throw err;
  }
};

export const delete__api_friend_reminders_id_14 = async (c: Context<Env, "/api/friend-reminders/:id">) => {
  try {
    // staff も通す分、先に登録行の所属を引いて担当外アカウントを隠す。
    const enrollmentRow = await c.env.DB.prepare(
      `SELECT friend_id, reminder_id FROM friend_reminders WHERE id = ?`,
    ).bind(c.req.param('id')).first<{ friend_id: string; reminder_id: string }>();
    if (!enrollmentRow) {
      return c.json({ success: false, error: 'Friend reminder not found' }, 404);
    }
    const friend = await getFriendById(c.env.DB, enrollmentRow.friend_id);
    const reminder = await getReminderById(c.env.DB, enrollmentRow.reminder_id);
    const friendAccountId = friend
      ? ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null
      : null;
    const reminderAccountId = reminder
      ? (reminder as { line_account_id?: string | null }).line_account_id ?? null
      : null;
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [friendAccountId, reminderAccountId])) {
      return c.json({ success: false, error: 'Friend reminder not found' }, 404);
    }
    // R350: 一覧側の取消と同じ処理へ寄せる。番号・理由・未送信の停止を
    // 一貫させ、送信待ちが残って通知が続くのを防ぐ。応答の形は変えない。
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const current = await getReminderRegistrantById(
      c.env.DB, enrollmentRow.reminder_id, c.req.param('id'), scope,
    );
    if (!current) {
      return c.json({ success: false, error: 'Friend reminder not found' }, 404);
    }
    const cancelled = await cancelReminderRegistrant(c.env.DB, {
      reminderId: enrollmentRow.reminder_id,
      enrollmentId: c.req.param('id'),
      expectedLockVersion: current.lock_version,
      cancelReason: 'manual_registration_cancelled',
      scope,
    });
    if (cancelled.state === 'not_found') {
      return c.json({ success: false, error: 'Friend reminder not found' }, 404);
    }
    if (cancelled.state === 'conflict') {
      return c.json({ success: false, error: 'ほかの担当者による変更があります。一覧を読み直してください。' }, 409);
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    throw err;
  }
};

export const post__api_reminder_runs_runId_retry_15 = async (c: Context<Env, "/api/reminder-runs/:runId/retry">) => {
  try {
    const run = await getReminderDeliveryRunById(c.env.DB, c.req.param('runId'));
    if (!run) return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
    // R348/R349: 所属が変わったルールの旧実行行は、行の送信元アカウントで
    // 判定する。親だけを見ると旧担当が再試行できず、逆に現担当が旧行へ届く。
    // 未所属の旧行だけは従来どおり親で判定する。
    const runAccountId = (run as { line_account_id?: string | null }).line_account_id ?? null;
    const reminder = await getReminderById(c.env.DB, run.reminder_id);
    if (!reminder) return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
    if (runAccountId !== null) {
      // 送信元が分かる行はその所属だけで判定する。親の今の所属を足すと、
      // 旧担当が締め出され、現担当が旧行へ届いてしまう。
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [runAccountId])) {
        return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
      }
    } else {
      const accountId = (reminder as { line_account_id?: string | null }).line_account_id ?? null;
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
        return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
      }
    }

    const requestKey = c.req.header('Idempotency-Key');
    if (!isValidIdempotencyKey(requestKey)) {
      return inputError(c, { success: false, error: '再試行キーが必要です' }, 400, []);
    }
    const retried = await retryReminderDeliveryRun(c.env.DB, {
      id: run.id,
      requestKey,
      now: new Date().toISOString(),
    });
    if (!retried) return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
    if (retried.kind === 'conflict') {
      if(retried.run.last_error_code==='retry_after_exceeds_budget')return c.json({success:false,code:'retry_after_exceeds_budget',error:'連携先の待機期限が再試行の予算を超えました。連携先の状態を確認してください。'},409);
      if(retried.run.next_retry_at&&Date.parse(retried.run.next_retry_at)>Date.now())return c.json({success:false,code:'retry_after_pending',error:'連携先から指定された待機期限前には再送できません。'},409);
      if (['delivery_started','delivery_unknown'].includes(retried.run.last_error_code ?? '')) {
        return c.json({success:false,code:'delivery_unknown',error:'送信結果を確認できないため再送できません。LINEの送信履歴を確認してください。'},409);
      }
      return c.json({ success: false, error: 'この実行は再試行できる状態ではありません' }, 409);
    }
    return c.json({
      success: true,
      data: { id: retried.run.id, status: retried.run.status, replayed: retried.kind === 'replay' },
    });
  } catch (err) {
    throw err;
  }
};
