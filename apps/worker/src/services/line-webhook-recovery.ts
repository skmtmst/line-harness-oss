import {
  getFriendById, getLineWebhookEvent, getWorkflowStep, failWorkflowStep,
  markLineWebhookEventFailed, markLineWebhookEventSucceeded, recordAnalyticsEvent,
  upsertChatOnMessage, ensureWorkflowStep, recordIncomingLineMessage, type LineWebhookEventRow, type WorkflowStepRow,
} from '@line-crm/db';


import type { Env } from '../worker-env.js';
import { acquireWorkflow } from './workflow-execution.js';
import { awardActivityMileage } from './activity-mileage.js';
import { fireEvent, processScoring } from './event-bus.js';

export const LINE_RECOVERY_REASONS = {
  input_unavailable: 'やり直しに必要な受信の入力が残っていません。元の受信内容を確認してください。',
  reply_input_unavailable: '返信の鍵が残っていないため自動返信できません。送信履歴を確認し、必要なら受信箱から担当者が返信してください。',
  delivery_unknown: '送信または処理が済んだか確認できません。履歴を確認し、自動で送り直さないでください。',
  source_removed: '元の受信が取り消されたか、お客さまが削除されたため再開しません。',
  follow_routing_unavailable: '友だち追加の振り分けと送信の途中状態を復元できません。マイル以外は追加時の実行履歴を確認してください。',
  account_inactive: '受信元のアカウントまたは契約が停止中のため再開しません。',
  attempt_limit: '再処理の回数上限に達しました。処理の履歴と失敗の原因を確認してください。',
} as const;
type ReviewCode = keyof typeof LINE_RECOVERY_REASONS;
export type LineRecoveryResult = { status: 'succeeded' | 'needs_review' | 'busy' | 'failed'; reasonCode?: ReviewCode; reason?: string };
const refFor = (row: LineWebhookEventRow) => ({ scopeId: `line:${row.line_account_id ?? 'default'}`, processKind: 'line_event', subjectId: row.webhook_event_id });
const eventTime = (stamp: string) => new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(stamp) ? stamp : `${stamp}+09:00`).toISOString();
const value = <T>(row: WorkflowStepRow | null): T | null => row?.status === 'succeeded' && row.result_json ? JSON.parse(row.result_json) as T : null;

export async function lineWebhookRecoveryView(db: D1Database, row: LineWebhookEventRow): Promise<LineRecoveryResult | null> {
  if (row.status === 'succeeded') return null;
  const root = await getWorkflowStep(db, { ...refFor(row), stepKey: '__run' });
  if (!root || root.status === 'unknown' || root.status === 'exhausted') {
    const reasonCode = root?.error_code && root.error_code in LINE_RECOVERY_REASONS ? root.error_code as ReviewCode : 'delivery_unknown';
    return { status: 'needs_review', reasonCode, reason: LINE_RECOVERY_REASONS[reasonCode] };
  }
  return null;
}

/** Read-only eligibility: a retry needs saved inputs and unfinished recoverable work. */
export async function lineWebhookCanRetry(db: D1Database, row: LineWebhookEventRow): Promise<boolean> {
  if (row.status !== 'failed') return false;
  const ref = refFor(row);
  const root = await getWorkflowStep(db, { ...ref, stepKey: '__run' });
  if (!root || !['pending', 'failed'].includes(root.status) || root.attempt_count >= root.max_attempts) return false;
  if (row.line_account_id) {
    const active = await db.prepare(`SELECT 1 FROM line_accounts la LEFT JOIN tenants t ON t.id=la.tenant_id
      WHERE la.id=? AND la.is_active=1 AND la.archived_at IS NULL AND (t.status IS NULL OR t.status='active')`)
      .bind(row.line_account_id).first();
    if (!active) return false;
  }
  const step = (key: string) => getWorkflowStep(db, { ...ref, stepKey: key });
  let keys: string[] = [];
  if (row.event_type === 'message' || row.event_type === 'postback') {
    const messageEvent = row.event_type === 'message';
    const checkpoint = messageEvent ? 'incoming_message' : 'incoming_postback_log';
    const saved = await step(checkpoint);
    const recorded = messageEvent ? value<{ id: string; isUnsent: boolean; inserted: boolean }>(saved) : null;
    let id = messageEvent ? (recorded?.isUnsent || recorded?.inserted === false ? null : recorded?.id) : value<string>(saved);
    if (!id && !(recorded?.isUnsent || recorded?.inserted === false)) {
      const sql = await step(`${checkpoint}:sql:0`);
      const results = value<Array<{ meta: { changes: number } }>>(sql);
      const plan = sql?.input_json ? JSON.parse(sql.input_json) as Array<{ sql: string; args: unknown[] }> : [];
      if (results?.[0]?.meta.changes === 1 && plan.length === 1 && /^INSERT(?: OR IGNORE)? INTO messages_log\s*\(id, friend_id, direction, message_type, content,/i.test(plan[0]!.sql.trim()) && typeof plan[0]!.args[0] === 'string') id = plan[0]!.args[0];
    }
    if (!id) return false;
    const message = await db.prepare(`SELECT m.message_type,m.line_event_at FROM messages_log m JOIN friends f ON f.id=m.friend_id
      WHERE m.id=? AND m.direction='incoming' AND m.unsent_at IS NULL AND m.line_account_id IS ? AND f.line_account_id IS ?`)
      .bind(id, row.line_account_id, row.line_account_id).first<{ message_type: string; line_event_at: string | null }>();
    if (!message) return false;
    if (!messageEvent && !value<{ plain: boolean }>(await step('postback_context'))?.plain) return false;
    keys = messageEvent ? [`awardActivityMileage:${message.message_type === 'text' ? 0 : 1}`] : [];
    if (message.line_event_at && (message.message_type === 'text' || !messageEvent)) keys.push('event:scoring');
    const replyKnown = value(await step('auto_reply')) || value<{ configured: boolean }>(await step('reply_policy'))?.configured === false;
    if (replyKnown && message.line_event_at) keys.push(messageEvent ? (message.message_type === 'text' ? 'fireEvent:0' : 'recordWebhookAnalyticsEvent:0') : 'fireEvent:1');
  } else if (row.event_type === 'follow' || row.event_type === 'unfollow') {
    const saved = row.event_type === 'follow' ? value<{ id: string }>(await step('friend')) : value<{ friendId: string | null; applied: boolean }>(await step('unfollow_relationship'));
    if (!saved || ('applied' in saved && saved.applied === false)) return false;
    const friendId = 'id' in saved ? saved.id : saved.friendId;
    if (friendId) {
      const friend = await getFriendById(db, friendId);
      if (!friend || friend.line_account_id !== row.line_account_id) return false;
    }
    keys = row.event_type === 'follow' ? ['awardActivityMileage:2'] : ['recordWebhookAnalyticsEvent:2', ...(friendId ? ['fireEvent:3'] : [])];
  }
  for (const key of keys) {
    const saved = await step(key);
    if (!saved || (['pending', 'failed'].includes(saved.status) && saved.attempt_count < saved.max_attempts)) return true;
  }
  return false;
}

/** Rebuild only from an exact checkpoint-to-domain reference, never by matching text/time. */
export async function retryLineWebhookEvent(env: Env['Bindings'], row: LineWebhookEventRow): Promise<LineRecoveryResult> {
  const db = env.DB, ref = refFor(row), rootRef = { ...ref, stepKey: '__run' };
  if (row.status === 'succeeded') return { status: 'succeeded' };
  const root = await getWorkflowStep(db, rootRef);
  if (!root) {
    await ensureWorkflowStep(db, rootRef, { status: 'unknown' });
    await db.prepare("UPDATE workflow_steps SET error_code='input_unavailable' WHERE scope_id=? AND process_kind='line_event' AND subject_id=? AND step_key='__run' AND status='unknown'").bind(ref.scopeId, ref.subjectId).run();
    await markLineWebhookEventFailed(db, row.webhook_event_id, 'unknown');
    return { status: 'needs_review', reasonCode: 'input_unavailable', reason: LINE_RECOVERY_REASONS.input_unavailable };
  }
  if (root.status === 'succeeded') { await markLineWebhookEventSucceeded(db, row.webhook_event_id); return { status: 'succeeded' }; }
  const review = await lineWebhookRecoveryView(db, row);
  if (review) return review;
  const execution = await acquireWorkflow(db, ref);
  if (!execution) return await lineWebhookRecoveryView(db, row) ?? { status: 'busy' };
  const hold = async (code: ReviewCode): Promise<LineRecoveryResult> => {
    await markLineWebhookEventFailed(execution.db, row.webhook_event_id, 'unknown');
    await failWorkflowStep(db, rootRef, execution.owner, { unknown: true, code, delayMs: 0 });
    return { status: 'needs_review', reasonCode: code, reason: LINE_RECOVERY_REASONS[code] };
  };
  try {
    const account = row.line_account_id ? await db.prepare(`SELECT la.channel_access_token,la.channel_access_token_encrypted,la.is_active,la.archived_at,t.status AS tenant_status
      FROM line_accounts la LEFT JOIN tenants t ON t.id=la.tenant_id WHERE la.id=?`).bind(row.line_account_id)
      .first<{ channel_access_token: string; channel_access_token_encrypted: string | null; is_active: number; archived_at: string | null; tenant_status: string | null }>() : null;
    if (row.line_account_id && (!account || !account.is_active || account.archived_at || (account.tenant_status && account.tenant_status !== 'active'))) return hold('account_inactive');
    const token = account ? await (await import('@line-crm/db')).resolveLineCredential(account.channel_access_token_encrypted, account.channel_access_token,
      { lineAccountId: row.line_account_id!, field: 'channel_access_token' }) : env.LINE_CHANNEL_ACCESS_TOKEN;
    const step = (key: string) => getWorkflowStep(db, { ...ref, stepKey: key });
    if (row.event_type === 'message') {
      let recorded = value<{ id: string; inserted: boolean; isUnsent: boolean }>(await step('incoming_message'));
      if (!recorded) {
        // The INSERT and SQL receipt may have committed before the parent checkpoint.
        // Only a proven successful INSERT identifies this event's exact inbox row.
        const sqlStep = await step('incoming_message:sql:0');
        const results = value<Array<{ meta: { changes: number } }>>(sqlStep);
        const plan = sqlStep?.input_json ? JSON.parse(sqlStep.input_json) as Array<{ sql: string; args: unknown[] }> : [];
        if (results?.[0]?.meta.changes === 1 && plan.length === 1 && /^INSERT OR IGNORE INTO messages_log\s*\(id, friend_id, direction, message_type, content,/i.test(plan[0]!.sql.trim()) && typeof plan[0]!.args[0] === 'string') {
          recorded = { id: plan[0]!.args[0], inserted: true, isUnsent: false };
        }
      }
      if (!recorded) return hold('input_unavailable');
      const message = await db.prepare(`SELECT id,friend_id,message_type,content,line_event_at,created_at,unsent_at,line_message_id,line_message_account_key,quote_token
        FROM messages_log WHERE id=? AND direction='incoming' AND line_account_id IS ?`).bind(recorded.id, row.line_account_id)
        .first<{ id: string; friend_id: string; message_type: string; content: string; line_event_at: string | null; created_at: string; unsent_at: string | null;
          line_message_id: string; line_message_account_key: string; quote_token: string | null }>();
      if (!message || message.unsent_at || recorded.isUnsent) return hold('source_removed');
      const friend = await getFriendById(db, message.friend_id);
      if (!friend || friend.line_account_id !== row.line_account_id) return hold('source_removed');
      await execution.step('incoming_message', () => recordIncomingLineMessage(execution.mutationDb('incoming_message'), {
        id: message.id, friendId: friend.id, messageType: message.message_type, content: message.content, lineAccountId: row.line_account_id,
        lineMessageAccountKey: message.line_message_account_key, lineMessageId: message.line_message_id,
        createdAt: message.created_at, lineEventAt: message.line_event_at, quoteToken: message.quote_token,
      }));
      if (!recorded.inserted) { await execution.complete(); await markLineWebhookEventSucceeded(db, row.webhook_event_id); return { status: 'succeeded' }; }
      const text = message.message_type === 'text', mileageKey = `awardActivityMileage:${text ? 0 : 1}`;
      await execution.step(mileageKey, () => awardActivityMileage(execution.mutationDb(mileageKey), {
        eventType: 'message_received', source: 'line', sourceEventId: message.id, friendId: friend.id,
        metadata: { messageType: message.message_type }, ...(text ? { occurredAt: message.created_at } : {}),
      }));
      const policy = value<{ configured: boolean }>(await step('reply_policy'));
      let reply = value<{ matched: boolean; replyTokenConsumed: boolean }>(await step('auto_reply'));
      if (!reply) {
        const evaluated = await db.prepare(`SELECT status,winning_auto_reply_id,reply_status FROM auto_reply_evaluations
          WHERE incoming_event_id=? AND incoming_message_log_id=? AND friend_id=? AND line_account_id IS ?`)
          .bind(row.webhook_event_id, message.id, friend.id, row.line_account_id)
          .first<{ status: string; winning_auto_reply_id: string | null; reply_status: string }>();
        if (evaluated?.status === 'skipped' || evaluated?.status === 'completed') {
          reply = await execution.step('auto_reply', async () => ({ matched: Boolean(evaluated.winning_auto_reply_id || evaluated.reply_status === 'accepted'), replyTokenConsumed: evaluated.reply_status === 'accepted' }));
        }
      }
      if (!reply && policy?.configured === false) reply = await execution.step('auto_reply', async () => ({ matched: false, replyTokenConsumed: false }));
      if (!reply) {
        // Score rules depend on the receipt identity, friend and event time, not the reply decision.
        if (text && message.line_event_at) await execution.step('event:scoring', () => processScoring(execution.db, 'message_received', {
          sourceEventId: row.webhook_event_id, sourceKind: 'line_webhook', occurredAt: eventTime(message.line_event_at!), friendId: friend.id,
          eventData: { text: message.content },
        }, row.line_account_id, token, execution));
        return hold('reply_input_unavailable');
      }
      if (text && message.content === '体験を完了する') return hold('delivery_unknown');
      if (!message.line_event_at) return hold('input_unavailable');
      if (!reply.matched) await execution.step('incoming_chat', () => upsertChatOnMessage(execution.mutationDb('incoming_chat'), friend.id, message.line_event_at!));
      const occurredAt = eventTime(message.line_event_at);
      if (!text) await execution.step('recordWebhookAnalyticsEvent:0', () => recordAnalyticsEvent(execution.mutationDb('recordWebhookAnalyticsEvent:0'), {
        lineAccountId: row.line_account_id!, friendId: friend.id, eventType: 'message_received', sourceKind: 'line_webhook',
        sourceId: row.webhook_event_id, occurredAt, dimensions: { messageType: message.message_type, matched: reply!.matched },
      }));
      if (text) {
        const missing: { code?: ReviewCode } = {};
        try { await execution.step('fireEvent:0', () => fireEvent(execution.db, 'message_received', {
          sourceEventId: row.webhook_event_id, sourceKind: 'line_webhook', occurredAt, friendId: friend.id,
          eventData: { text: message.content, matched: reply!.matched }, recoveryWithoutReply: true,
          onRecoveryReview: (code) => { if (missing.code !== 'delivery_unknown') missing.code = code; },
        }, token, row.line_account_id, execution)); } catch (error) { if (missing.code) return hold(missing.code); throw error; }
        if (missing.code) return hold(missing.code);
      }
    } else if (row.event_type === 'postback') {
      const context = value<{ plain: boolean; hasData: boolean }>(await step('postback_context'));
      let logId = value<string>(await step('incoming_postback_log'));
      if (!logId) {
        const sqlStep = await step('incoming_postback_log:sql:0');
        const results = value<Array<{ meta: { changes: number } }>>(sqlStep);
        const plan = sqlStep?.input_json ? JSON.parse(sqlStep.input_json) as Array<{ sql: string; args: unknown[] }> : [];
        if (results?.[0]?.meta.changes === 1 && plan.length === 1 && /^INSERT INTO messages_log\s*\(id, friend_id, direction, message_type, content,/i.test(plan[0]!.sql.trim()) && typeof plan[0]!.args[0] === 'string') logId = plan[0]!.args[0];
      }
      if (!context?.plain || !logId) return hold('input_unavailable');
      const message = await db.prepare(`SELECT friend_id,content,line_event_at FROM messages_log
        WHERE id=? AND direction='incoming' AND source='postback' AND line_account_id IS ?`).bind(logId, row.line_account_id)
        .first<{ friend_id: string; content: string; line_event_at: string | null }>();
      if (!message) return hold('source_removed');
      const friend = await getFriendById(db, message.friend_id);
      if (!friend || friend.line_account_id !== row.line_account_id) return hold('source_removed');
      const restoredId = logId;
      await execution.step('incoming_postback_log', async () => restoredId);
      if (!message.line_event_at) return hold('input_unavailable');
      const reply = value<{ matched: boolean }>(await step('auto_reply'));
      const policy = value<{ configured: boolean }>(await step('reply_policy'));
      if (!reply && policy?.configured !== false) {
        await execution.step('event:scoring', () => processScoring(execution.db, 'postback_received', {
          sourceEventId: row.webhook_event_id, sourceKind: 'line_webhook', occurredAt: eventTime(message.line_event_at!), friendId: friend.id,
          eventData: { text: context.hasData ? message.content : '' },
        }, row.line_account_id, token, execution));
        return hold('reply_input_unavailable');
      }
      if (!reply) await execution.step('auto_reply', async () => ({ matched: false, replyTokenConsumed: false }));
      const missing: { code?: ReviewCode } = {};
      try { await execution.step('fireEvent:1', () => fireEvent(execution.db, 'postback_received', {
        sourceEventId: row.webhook_event_id, sourceKind: 'line_webhook', occurredAt: eventTime(message.line_event_at!), friendId: friend.id,
        eventData: { text: context.hasData ? message.content : '', matched: reply?.matched ?? false }, recoveryWithoutReply: true,
        onRecoveryReview: (code) => { if (missing.code !== 'delivery_unknown') missing.code = code; },
      }, token, row.line_account_id, execution)); } catch (error) { if (missing.code) return hold(missing.code); throw error; }
      if (missing.code) return hold(missing.code);
    } else if (row.event_type === 'follow') {
      const saved = value<{ id: string; first_followed_at: string | null; created_at: string }>(await step('friend'));
      if (!saved) return hold('input_unavailable');
      const friend = await getFriendById(db, saved.id);
      if (!friend || friend.line_account_id !== row.line_account_id) return hold('source_removed');
      const stamp = saved.first_followed_at ?? saved.created_at;
      await execution.step('awardActivityMileage:2', () => awardActivityMileage(execution.mutationDb('awardActivityMileage:2'), {
        eventType: 'friend_registered', source: 'line_relationship', sourceEventId: `${friend.id}:friend_registered:${stamp}`,
        friendId: friend.id, subjectKey: friend.id, metadata: { lineAccountId: row.line_account_id }, occurredAt: stamp,
      }));
      return hold('follow_routing_unavailable');
    } else if (row.event_type === 'unfollow') {
      const saved = value<{ friendId: string | null; applied: boolean | undefined; occurredAt: string }>(await step('unfollow_relationship'));
      if (!saved) return hold('input_unavailable');
      if (saved.applied !== false) {
        const friend = saved.friendId ? await getFriendById(db, saved.friendId) : null;
        if (saved.friendId && (!friend || friend.line_account_id !== row.line_account_id)) return hold('source_removed');
        await execution.step('recordWebhookAnalyticsEvent:2', () => recordAnalyticsEvent(execution.mutationDb('recordWebhookAnalyticsEvent:2'), {
          lineAccountId: row.line_account_id!, friendId: saved.friendId, eventType: 'friend_unfollow', sourceKind: 'line_webhook', sourceId: row.webhook_event_id,
          occurredAt: eventTime(saved.occurredAt),
        }));
        if (friend) {
          const missing: { code?: ReviewCode } = {};
          try { await execution.step('fireEvent:3', () => fireEvent(execution.db, 'friend_unfollow', {
            sourceEventId: row.webhook_event_id, sourceKind: 'line_webhook', occurredAt: eventTime(saved.occurredAt), friendId: friend.id,
            recoveryWithoutReply: true,
            onRecoveryReview: (code) => { if (missing.code !== 'delivery_unknown') missing.code = code; },
          }, token, row.line_account_id, execution)); } catch (error) { if (missing.code) return hold(missing.code); throw error; }
          if (missing.code) return hold(missing.code);
        }
      }
    } else return hold('input_unavailable');
    // The root is completed first. A lost ledger update is repaired without repeating steps.
    await execution.complete();
    await markLineWebhookEventSucceeded(db, row.webhook_event_id);
    return { status: 'succeeded' };
  } catch {
    const uncertain = await db.prepare("SELECT 1 FROM workflow_steps WHERE scope_id=? AND process_kind='line_event' AND subject_id=? AND step_key!='__run' AND status IN ('unknown','exhausted') LIMIT 1").bind(ref.scopeId, ref.subjectId).first();
    if (uncertain) return hold('delivery_unknown');
    await markLineWebhookEventFailed(execution.db, row.webhook_event_id, 'unknown').catch(() => undefined);
    await execution.fail();
    return { status: 'failed' };
  }
}

/** Bounded, sequential recovery; unknown/exhausted work is never automatically reclaimed. */
export async function processDueLineWebhookRetries(env: Env['Bindings'], limit = 20): Promise<void> {
  const rows = await env.DB.prepare(`SELECT e.webhook_event_id FROM line_webhook_events e
    LEFT JOIN workflow_steps w ON w.scope_id='line:'||COALESCE(e.line_account_id,'default') AND w.process_kind='line_event'
      AND w.subject_id=e.webhook_event_id AND w.step_key='__run'
    WHERE e.status!='succeeded' AND (w.subject_id IS NULL OR (w.status IN ('pending','failed') AND (w.next_attempt_at IS NULL OR w.next_attempt_at<=?))
      OR w.status='succeeded' OR (w.status='running' AND w.lease_expires_at<=?)) ORDER BY w.updated_at LIMIT ?`)
    .bind(Date.now(), Date.now(), Math.max(1, Math.min(limit, 100))).all<{ webhook_event_id: string }>();
  for (const item of rows.results) {
    const row = await getLineWebhookEvent(env.DB, item.webhook_event_id);
    if (row) await retryLineWebhookEvent(env, row);
  }
}
