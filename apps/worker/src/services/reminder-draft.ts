import {
  getFriendById,
  getLineAccountById,
  getReminderVersionSteps,
  jstNow,
  type ReminderDraftSettings,
  type ReminderVersionRow,
} from '@line-crm/db';
import { resolveReminderSendAt } from '@line-crm/shared';
import { LineClient } from '@line-crm/line-sdk';
import { buildReminderStepMessage } from './reminder-delivery.js';
import {
  completeOutboundSendStatement,
  hashOutboundPayload,
  reserveOutboundSend,
} from './outbound-idempotency.js';

export interface ReminderValidationResult {
  valid: boolean;
  checks: Array<{
    key: string;
    label: string;
    status: 'passed' | 'failed';
    message: string;
  }>;
  audience: { matched: number; excluded: number };
}

export interface ReminderPreviewResult {
  targetDate: string;
  items: Array<{
    stableStepId: string;
    stepNumber: number;
    scheduledAt: string;
    label: string;
    state: 'scheduled' | 'past' | 'duplicate';
  }>;
  summary: {
    audience: number;
    next7Days: number;
    next30Days: number;
    duplicateCount: number;
  };
}

function check(
  key: string,
  label: string,
  passed: boolean,
  message: string,
): ReminderValidationResult['checks'][number] {
  return { key, label, status: passed ? 'passed' : 'failed', message };
}

export async function countReminderAudience(
  db: D1Database,
  settings: ReminderDraftSettings,
): Promise<{ matched: number; excluded: number }> {
  const total = await db.prepare(
    `SELECT COUNT(*) AS count FROM friends WHERE line_account_id = ?`,
  ).bind(settings.lineAccountId).first<{ count: number }>();
  const matched = settings.targetTagId
    ? await db.prepare(
        `SELECT COUNT(DISTINCT f.id) AS count
           FROM friends f
           JOIN friend_tags ft ON ft.friend_id = f.id AND ft.tag_id = ?
          WHERE f.line_account_id = ? AND f.is_following = 1`,
      ).bind(settings.targetTagId, settings.lineAccountId).first<{ count: number }>()
    : await db.prepare(
        `SELECT COUNT(*) AS count FROM friends
          WHERE line_account_id = ? AND is_following = 1`,
      ).bind(settings.lineAccountId).first<{ count: number }>();
  const totalCount = Number(total?.count ?? 0);
  const matchedCount = Number(matched?.count ?? 0);
  return { matched: matchedCount, excluded: Math.max(0, totalCount - matchedCount) };
}

export async function validateReminderDraft(
  db: D1Database,
  settings: ReminderDraftSettings,
  version: ReminderVersionRow,
): Promise<ReminderValidationResult> {
  const checks: ReminderValidationResult['checks'] = [];
  checks.push(check('name', '管理名', Boolean(settings.name.trim()), '管理名が入力されています'));
  checks.push(check('account', 'LINEアカウント', Boolean(settings.lineAccountId), '送信元が選ばれています'));
  checks.push(check('steps', '通知ステップ', settings.steps.length > 0, `${settings.steps.length}件の通知があります`));
  const bodiesValid = settings.steps.every((step) => Boolean(step.templateId || step.messageContent.trim()));
  checks.push(check('messages', '送る内容', bodiesValid, bodiesValid
    ? 'すべての通知に送る内容があります'
    : '送る内容が空の通知があります'));
  const scheduleKeys = settings.steps.map((step) => settings.deliveryMode === 'time'
    ? `${step.offsetDays ?? 0}:${step.sendAtTime ?? ''}`
    : String(step.offsetMinutes));
  const noDuplicates = new Set(scheduleKeys).size === scheduleKeys.length;
  checks.push(check('duplicate_schedule', '送信時刻の重複', noDuplicates, noDuplicates
    ? '同じ時刻の通知はありません'
    : '同じ時刻になる通知があります'));
  const fieldValid = settings.triggerType !== 'friend_field' || Boolean(settings.triggerFieldId);
  checks.push(check('trigger_field', '基準日', fieldValid, fieldValid
    ? '基準日が設定されています'
    : '基準日に使う友だち情報欄を選んでください'));
  const stopConfirmed = settings.stopConditions.bookingCancelled
    || settings.stopConditions.supportMarkCompleted
    || settings.stopConditions.friendBlocked
    || settings.stopConditions.daysAfterTarget !== null;
  checks.push(check('stop_conditions', '終了・停止条件', stopConfirmed, stopConfirmed
    ? '終了・停止条件が設定されています'
    : '終了・停止条件を1つ以上設定してください'));
  const testPassed = version.last_test_status === 'succeeded';
  checks.push(check('test_send', 'テスト送信', testPassed, testPassed
    ? '直近のテスト送信が成功しています'
    : '公開前にテスト送信を成功させてください'));
  const audience = await countReminderAudience(db, settings);
  return { valid: checks.every((item) => item.status === 'passed'), checks, audience };
}

export async function previewReminderDraft(
  db: D1Database,
  settings: ReminderDraftSettings,
  targetDate: Date,
): Promise<ReminderPreviewResult> {
  const audience = await countReminderAudience(db, settings);
  const now = new Date();
  const dates = settings.steps.map((step, index) => ({
    step,
    stepNumber: index + 1,
    scheduledAt: resolveReminderSendAt(targetDate, {
      offsetDays: step.offsetDays ?? null,
      sendAtTime: step.sendAtTime ?? null,
      offsetMinutes: step.offsetMinutes,
    }, settings.deliveryMode),
  }));
  const counts = new Map<string, number>();
  for (const { scheduledAt } of dates) {
    const key = scheduledAt.toISOString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const next7 = new Date(now.getTime() + 7 * 86_400_000);
  const next30 = new Date(now.getTime() + 30 * 86_400_000);
  return {
    targetDate: targetDate.toISOString(),
    items: dates.map(({ step, stepNumber, scheduledAt }) => ({
      stableStepId: step.stableStepId,
      stepNumber,
      scheduledAt: scheduledAt.toISOString(),
      label: settings.deliveryMode === 'time'
        ? `${step.offsetDays ?? 0}日 ${step.sendAtTime ?? '—'}`
        : `${step.offsetMinutes}分`,
      state: (counts.get(scheduledAt.toISOString()) ?? 0) > 1
        ? 'duplicate'
        : scheduledAt <= now ? 'past' : 'scheduled',
    })),
    summary: {
      audience: audience.matched,
      next7Days: dates.filter(({ scheduledAt }) => scheduledAt > now && scheduledAt <= next7).length * audience.matched,
      next30Days: dates.filter(({ scheduledAt }) => scheduledAt > now && scheduledAt <= next30).length * audience.matched,
      duplicateCount: [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    },
  };
}

export async function testReminderDraft(
  db: D1Database,
  version: ReminderVersionRow,
  settings: ReminderDraftSettings,
  requestKey: string,
): Promise<{ sent: number; recipientName: string; replayed: boolean; testedAt: string; requestId: string | null }> {
  const setting = await db.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'test_recipients'`,
  ).bind(settings.lineAccountId).first<{ value: string }>();
  const friendId = setting ? (JSON.parse(setting.value) as string[])[0] : undefined;
  if (!friendId) throw new Error('REMINDER_TEST_RECIPIENT_NOT_CONFIGURED');
  const friend = await getFriendById(db, friendId);
  if (!friend || friend.line_account_id !== settings.lineAccountId || !friend.is_following) {
    throw new Error('REMINDER_TEST_RECIPIENT_NOT_AVAILABLE');
  }
  const step = (await getReminderVersionSteps(db, version.id))[0];
  if (!step) throw new Error('REMINDER_TEST_STEP_NOT_FOUND');

  const payloadHash = await hashOutboundPayload(JSON.stringify({
    versionId: version.id,
    stepId: step.id,
    friendId,
    content: step.message_content,
  }));
  const now = jstNow();
  const reservation = await reserveOutboundSend(db, {
    key: requestKey,
    channel: 'line',
    resourceId: `reminder-test:${version.id}:${friendId}:${step.id}`,
    payloadHash,
    retryInProgress: true,
    now,
  });
  if (reservation.kind === 'conflict') throw new Error('REMINDER_TEST_KEY_CONFLICT');
  if (reservation.kind === 'replay') {
    return {
      sent: 1,
      recipientName: friend.display_name ?? 'テスト送信先',
      replayed: true,
      testedAt: now,
      requestId: null,
    };
  }

  const account = await getLineAccountById(db, settings.lineAccountId);
  if (!account) throw new Error('REMINDER_LINE_ACCOUNT_NOT_FOUND');
  const built = await buildReminderStepMessage(db, step, friend, new Date());
  const response = await new LineClient(account.channel_access_token)
    .pushMessageWithRequestId(friend.line_user_id, [built.message], requestKey);
  const logId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO messages_log
         (id, friend_id, direction, message_type, content, template_id_at_send,
          delivery_type, source, line_account_id, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, ?, 'test', 'reminder_test', ?, ?)`,
    ).bind(
      logId,
      friend.id,
      built.messageType,
      built.messageContent,
      built.templateId,
      settings.lineAccountId,
      now,
    ),
    completeOutboundSendStatement(db, {
      key: requestKey,
      responseId: response.requestId ?? logId,
      now,
    }),
  ]);
  return {
    sent: 1,
    recipientName: friend.display_name ?? 'テスト送信先',
    replayed: false,
    testedAt: now,
    requestId: response.requestId ?? null,
  };
}
