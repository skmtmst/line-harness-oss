import { inputJsonBoundary } from '../lib/input-errors.js';

import { Hono } from 'hono';

import type { Env } from '../worker-env.js';
import { requireDeliveryAccess, requireRole, denyReadOnly } from '../middleware/role-guard.js';

import { patch__api_reminders_reorder_1, get__api_reminders_2, post__api_reminders_drafts_3, get__api_reminders_id_4, get__api_reminders_id_draft_5, put__api_reminders_id_draft_6, post__api_reminders_id_validate_7, post__api_reminders_id_audience_8, post__api_reminders_id_message_preview_9, post__api_reminders_id_preview_10, get__api_reminders_id_test_recipient_11, post__api_reminders_id_test_send_12, post__api_reminders_id_publish_13 } from './reminders-drafts-handlers.js';
import { readDraftSettings, validateReminderDraftReferences, requireVisibleReminder } from './reminders-definition.js';
import { get__api_reminders_id_runs_1, post__api_reminders_2, put__api_reminders_id_3, delete__api_reminders_id_4, post__api_reminders_id_restore_5, post__api_reminders_id_steps_6, delete__api_reminders_id_steps_stepId_7, post__api_reminders_id_enroll_friendId_8, get__api_reminders_id_registrants_9, patch__api_reminders_id_registrants_enrollmentId_10, post__api_reminders_id_registrants_enrollmentId_cancel_11, post__api_reminders_id_registrants_enrollmentId_resume_12, get__api_friends_friendId_reminders_13, delete__api_friend_reminders_id_14, post__api_reminder_runs_runId_retry_15 } from './reminders-lifecycle-handlers.js';

const reminders = new Hono<Env>();
export { readDraftSettings } from './reminders-definition.js';
export { validateReminderDraftReferences } from './reminders-definition.js';

// ========== リマインダCRUD ==========

/**
 * PATCH /api/reminders/reorder — 並び順をまとめて書く。
 *
 * 経路が /api/reminders/:id より前にあるのは、:id に "reorder" として
 * 吸われるのを避けるため（シナリオと同じ並べ方）。
 */
reminders.patch('/api/reminders/reorder', requireDeliveryAccess('reminders'), inputJsonBoundary(), patch__api_reminders_reorder_1);

reminders.get('/api/reminders', requireRole('owner', 'admin', 'staff'), get__api_reminders_2);

/** 7-1-B: 定義と初版下書きを一度に作る。 */
reminders.post('/api/reminders/drafts', requireDeliveryAccess('reminders'), inputJsonBoundary(), post__api_reminders_drafts_3);

reminders.use('/api/reminders/:id', requireVisibleReminder);

reminders.use('/api/reminders/:id/*', requireVisibleReminder);

reminders.get('/api/reminders/:id', get__api_reminders_id_4);

reminders.get('/api/reminders/:id/draft', get__api_reminders_id_draft_5);

reminders.put('/api/reminders/:id/draft', requireDeliveryAccess('reminders'), inputJsonBoundary(), put__api_reminders_id_draft_6);

reminders.post('/api/reminders/:id/validate', requireDeliveryAccess('reminders'), inputJsonBoundary(), post__api_reminders_id_validate_7);

/*
 * POST /api/reminders/:id/audience — 未保存の条件で人数を数え直す。
 *
 * 対象ステージで条件を書き換えるたびに呼ぶ。保存前の試算なので
 * 下書きは触らない。顔ぶれ (先頭20人) も同じ条件・範囲で切る。
 * 権限は検証の口と同じ (owner/admin + この店舗が見えること)。
 */
reminders.post('/api/reminders/:id/audience', requireDeliveryAccess('reminders'), inputJsonBoundary(), post__api_reminders_id_audience_8);

reminders.post('/api/reminders/:id/message-preview',requireRole('owner','admin'),denyReadOnly(),inputJsonBoundary({friendId:['string'],stableStepId:['string'],expectedDraftVersionId:['string'],expectedDraftUpdatedAt:['string'],deliveredAt:['string']}),post__api_reminders_id_message_preview_9);

reminders.post('/api/reminders/:id/preview', inputJsonBoundary(), post__api_reminders_id_preview_10);

/*
 * 送信前に「今設定されているテスト送信先」を返す。
 * testReminderDraft と同じ resolveReminderTestRecipient で判定するので、
 * 画面に出る送信先と実際に届く先がずれない。参照のみなので GET /draft と同じく
 * /reminders 権限があれば読める。
 */
reminders.get('/api/reminders/:id/test-recipient', get__api_reminders_id_test_recipient_11);

reminders.post('/api/reminders/:id/test-send', requireDeliveryAccess('reminders'), inputJsonBoundary(), post__api_reminders_id_test_send_12);

reminders.post('/api/reminders/:id/publish', requireDeliveryAccess('reminders'), inputJsonBoundary(), post__api_reminders_id_publish_13);

/** 7-1-H: 予定・成功・失敗を、未取得と0件を混ぜずに返す。 */
reminders.get('/api/reminders/:id/runs', get__api_reminders_id_runs_1);

reminders.post('/api/reminders', requireDeliveryAccess('reminders'), inputJsonBoundary({"name":["string"],"description":["string"],"lineAccountId":["null","string"]}), post__api_reminders_2);

reminders.put('/api/reminders/:id', requireDeliveryAccess('reminders'), inputJsonBoundary(), put__api_reminders_id_3);

reminders.delete('/api/reminders/:id', requireDeliveryAccess('reminders'), delete__api_reminders_id_4);

/**
 * POST /api/reminders/:id/restore — 削除の取り消し（B 元に戻す）。
 *
 * 定義の deleted_at だけを戻す。戻した直後は止めたまま。
 * 削除時に取り消した登録・配信予定は戻さない（日時が過ぎた相手へ
 * いきなり送らないため）。消していない行・無い行は 404。
 */
reminders.post('/api/reminders/:id/restore', requireDeliveryAccess('reminders'), inputJsonBoundary(), post__api_reminders_id_restore_5);

// ========== リマインダステップ ==========

reminders.post('/api/reminders/:id/steps', requireDeliveryAccess('reminders'), inputJsonBoundary({"offsetMinutes":["number"],"messageType":["string"],"messageContent":["string"],"offsetDays":["null","number"],"sendAtTime":["null","string"],"templateId":["null","string"]}), post__api_reminders_id_steps_6);

reminders.delete('/api/reminders/:id/steps/:stepId', requireDeliveryAccess('reminders'), delete__api_reminders_id_steps_stepId_7);

// ========== 友だちリマインダ登録 ==========

reminders.post('/api/reminders/:id/enroll/:friendId', requireRole('owner', 'admin', 'staff'), inputJsonBoundary({"targetDate":["string"]}), post__api_reminders_id_enroll_friendId_8);

/** N-064: リマインダ別の登録者を、直接URLから安全に確認できる一覧。 */
reminders.get('/api/reminders/:id/registrants', requireRole('owner', 'admin', 'staff'), get__api_reminders_id_registrants_9);

/** 基準日を変える。旧日程の未送信だけを止め、送信済み履歴は残す。 */
reminders.patch('/api/reminders/:id/registrants/:enrollmentId', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), patch__api_reminders_id_registrants_enrollmentId_10);

/** 取消は送信済み履歴を消さず、未送信行だけを止める。 */
reminders.post('/api/reminders/:id/registrants/:enrollmentId/cancel', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), post__api_reminders_id_registrants_enrollmentId_cancel_11);

/** 再開は未来の予定を作り直す (buildResumeExpectedRuns)。 */
reminders.post('/api/reminders/:id/registrants/:enrollmentId/resume', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), post__api_reminders_id_registrants_enrollmentId_resume_12);

reminders.get('/api/friends/:friendId/reminders', requireRole('owner', 'admin', 'staff'), get__api_friends_friendId_reminders_13);

reminders.delete('/api/friend-reminders/:id', requireRole('owner', 'admin', 'staff'), delete__api_friend_reminders_id_14);

/** 失敗した1通だけを、同じ依頼の二重受付なしで再試行する。 */
reminders.post('/api/reminder-runs/:runId/retry', requireDeliveryAccess('reminders'), inputJsonBoundary(), post__api_reminder_runs_runId_retry_15);

export { reminders };
