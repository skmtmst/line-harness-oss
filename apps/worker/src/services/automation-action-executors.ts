import {
  addTagToFriend,
  getLineAccountById,
  getSupportMarkById,
  jstNow,
  removeTagFromFriend,
  setFriendSupportMark,
} from '@line-crm/db';
import { LineClient, type Message } from '@line-crm/line-sdk';
import {
  AutomationActionError,
  type AutomationActionContext,
  type AutomationActionExecutor,
} from './automation-engine.js';
import {
  completeOutboundSendStatement,
  hashOutboundPayload,
  reserveOutboundSend,
} from './outbound-idempotency.js';
import { buildMessage } from './line-message.js';
import { recordDeliveryOutcome } from './outgoing-webhook-delivery.js';

interface AutomationLineClient {
  pushMessage(to: string, messages: Message[], retryKey?: string): Promise<unknown>;
  linkRichMenuToUser(userId: string, richMenuId: string): Promise<unknown>;
  unlinkRichMenuFromUser(userId: string): Promise<unknown>;
}

export interface AutomationActionExecutorDependencies {
  credentialEncryptionKey?: string;
  resolveLineAccessToken?: (db: D1Database, lineAccountId: string) => Promise<string | null>;
  createLineClient?: (accessToken: string) => AutomationLineClient;
  fetch?: typeof fetch;
  now?: () => string;
}

interface ScopedFriend {
  id: string;
  line_user_id: string;
  metadata: string;
}

function invalid(code: string, message: string): AutomationActionError {
  return new AutomationActionError(code, message, false);
}

function requiredString(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(code, `${label}が指定されていません`);
  return value.trim();
}

function requiredText(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(code, `${label}が指定されていません`);
  return value;
}

function parseRecord(value: unknown, code: string, label: string): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 下で項目エラーへ揃える。
    }
  }
  throw invalid(code, `${label}の形式が不正です`);
}

async function requireFriend(context: AutomationActionContext): Promise<ScopedFriend> {
  if (!context.friendId) throw invalid('friend_required', '対象の友だちが指定されていません');
  const friend = await context.db.prepare(
    `SELECT id, line_user_id, metadata
       FROM friends
      WHERE id = ? AND line_account_id = ?`,
  ).bind(context.friendId, context.lineAccountId).first<ScopedFriend>();
  if (!friend) throw invalid('friend_not_found', '対象の友だちがこのLINE公式アカウントにいません');
  return friend;
}

async function requireScopedResource(
  context: AutomationActionContext,
  input: { table: 'tags' | 'templates' | 'outgoing_webhooks'; id: string; code: string; label: string },
): Promise<void> {
  const row = await context.db.prepare(
    `SELECT id FROM ${input.table} WHERE id = ? AND line_account_id = ?`,
  ).bind(input.id, context.lineAccountId).first<{ id: string }>();
  if (!row) throw invalid(input.code, `${input.label}が見つからないか、別のLINE公式アカウントにあります`);
}

async function resolveAccessToken(
  context: AutomationActionContext,
  dependencies: AutomationActionExecutorDependencies,
): Promise<string> {
  let token: string | null | undefined;
  if (dependencies.resolveLineAccessToken) {
    token = await dependencies.resolveLineAccessToken(context.db, context.lineAccountId);
  } else {
    const account = await getLineAccountById(
      context.db,
      context.lineAccountId,
      dependencies.credentialEncryptionKey,
    );
    token = account?.is_active === 1 ? account.channel_access_token : null;
  }
  if (!token) throw invalid('line_access_token_missing', 'LINE送信用のアクセストークンがありません');
  return token;
}

function classifyLineError(error: unknown): AutomationActionError {
  if (error instanceof AutomationActionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const permanent = /LINE API error:\s*(400|401|403|404)\b/.test(message);
  return new AutomationActionError(
    permanent ? 'line_request_rejected' : 'line_temporary_failure',
    message,
    !permanent,
  );
}

async function reserveLineOperation(
  context: AutomationActionContext,
  payload: string,
): Promise<'send' | 'replay'> {
  const reservation = await reserveOutboundSend(context.db, {
    key: context.idempotencyKey,
    channel: 'line',
    resourceId: `${context.action.type}:${context.lineAccountId}:${context.friendId ?? ''}`,
    payloadHash: await hashOutboundPayload(payload),
    retryInProgress: true,
    now: jstNow(),
  });
  if (reservation.kind === 'conflict') {
    throw invalid('idempotency_key_conflict', '同じ処理IDに異なる送信内容が指定されました');
  }
  if (reservation.kind === 'in_progress') {
    throw new AutomationActionError('outbound_state_unavailable', '送信状態を確認できません', true);
  }
  return reservation.kind === 'replay' ? 'replay' : 'send';
}

async function completeLineOperation(
  context: AutomationActionContext,
  responseId: string,
): Promise<void> {
  await context.db.batch([
    completeOutboundSendStatement(context.db, {
      key: context.idempotencyKey,
      responseId,
      now: jstNow(),
    }),
  ]);
}

function strictMessage(type: string, content: string, altText?: string): Message {
  const allowed = new Set([
    'text', 'image', 'flex', 'carousel', 'location', 'video', 'audio', 'sticker',
  ]);
  if (!allowed.has(type)) throw invalid('message_type_unsupported', `メッセージ種別 ${type} は使えません`);
  if (!content.trim()) throw invalid('message_content_missing', 'メッセージ内容が空です');
  const message = buildMessage(type, content, altText);
  if (type !== 'text' && message.type === 'text') {
    throw invalid('message_content_invalid', `${type}メッセージの内容が不正です`);
  }
  return message;
}

async function resolveMessage(
  context: AutomationActionContext,
): Promise<{ message: Message; content: string }> {
  const templateId = context.action.params.templateId ?? context.action.params.template_id;
  if (templateId !== undefined) {
    const id = requiredString(templateId, 'template_id_missing', 'テンプレート');
    await requireScopedResource(context, {
      table: 'templates', id, code: 'template_not_found', label: 'テンプレート',
    });
    const template = await context.db.prepare(
      `SELECT message_type, message_content FROM templates
        WHERE id = ? AND line_account_id = ?`,
    ).bind(id, context.lineAccountId).first<{ message_type: string; message_content: string }>();
    if (!template) throw invalid('template_not_found', 'テンプレートが見つかりません');
    return {
      message: strictMessage(template.message_type, template.message_content, optionalString(context.action.params.altText)),
      content: template.message_content,
    };
  }
  const type = optionalString(context.action.params.messageType) ?? 'text';
  const content = requiredText(context.action.params.content, 'message_content_missing', 'メッセージ内容');
  return { message: strictMessage(type, content, optionalString(context.action.params.altText)), content };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function tagExecutor(context: AutomationActionContext, operation: 'add' | 'remove'): Promise<void> {
  const friend = await requireFriend(context);
  const tagId = requiredString(context.action.params.tagId, 'tag_id_missing', 'タグ');
  await requireScopedResource(context, { table: 'tags', id: tagId, code: 'tag_not_found', label: 'タグ' });
  if (operation === 'add') {
    await addTagToFriend(context.db, friend.id, tagId);
  } else {
    await removeTagFromFriend(context.db, friend.id, tagId);
  }
}

function replaceMessagePlaceholder(value: unknown, message: string): unknown {
  if (typeof value === 'string') return value.replace(/\{\{message\}\}/g, message);
  if (Array.isArray(value)) return value.map((item) => replaceMessagePlaceholder(item, message));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, replaceMessagePlaceholder(item, message)]),
    );
  }
  return value;
}

async function metadataExecutor(context: AutomationActionContext): Promise<void> {
  const friend = await requireFriend(context);
  const raw = context.action.params.values ?? context.action.params.data;
  const parsedValues = parseRecord(raw, 'metadata_invalid', '友だち情報');
  const message = typeof context.inputEvent.text === 'string' ? context.inputEvent.text : '';
  const values = replaceMessagePlaceholder(parsedValues, message) as Record<string, unknown>;
  const current = parseRecord(friend.metadata || '{}', 'friend_metadata_invalid', '現在の友だち情報');
  const result = await context.db.prepare(
    `UPDATE friends SET metadata = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ?`,
  ).bind(
    JSON.stringify({ ...current, ...values }),
    jstNow(),
    friend.id,
    context.lineAccountId,
  ).run();
  if ((result.meta?.changes ?? 0) !== 1) throw invalid('friend_update_failed', '友だち情報を更新できませんでした');
}

async function supportMarkExecutor(
  context: AutomationActionContext,
  dependencies: AutomationActionExecutorDependencies,
): Promise<void> {
  const friend = await requireFriend(context);
  const markId = requiredString(context.action.params.markId, 'support_mark_id_missing', '対応マーク');
  const account = await context.db.prepare(
    `SELECT tenant_id FROM line_accounts WHERE id = ?`,
  ).bind(context.lineAccountId).first<{ tenant_id: string }>();
  if (!account) throw invalid('line_account_not_found', 'LINE公式アカウントが見つかりません');
  const scope = { tenantId: account.tenant_id, lineAccountId: context.lineAccountId };
  const mark = await getSupportMarkById(context.db, markId, scope);
  if (!mark) {
    throw invalid('support_mark_not_found', '対応マークが見つからないか、別のLINE公式アカウントにあります');
  }

  const protectionMinutes = Number(context.action.params.manualProtectionMinutes ?? 0);
  if (Number.isFinite(protectionMinutes) && protectionMinutes > 0) {
    const now = dependencies.now?.() ?? new Date().toISOString();
    const protectedChange = await context.db.prepare(
      `SELECT 1 AS ok
         FROM operation_audit
        WHERE target_kind = 'support_mark' AND action = 'changed'
          AND friend_id = ? AND actor_id IS NOT NULL
          AND datetime(created_at) >= datetime(?, ?)
        LIMIT 1`,
    ).bind(friend.id, now, `-${Math.floor(protectionMinutes)} minutes`).first<{ ok: number }>();
    if (protectedChange) return;
  }

  const updated = await setFriendSupportMark(context.db, friend.id, mark.id, scope, null, {
    source: 'automation',
    automationId: context.automationId,
    automationVersionId: context.automationVersionId,
    sourceEventId: context.sourceEventId,
    reason: typeof context.inputEvent.type === 'string' ? context.inputEvent.type : 'condition_matched',
  });
  if (!updated) throw invalid('support_mark_update_failed', '対応マークを変更できませんでした');
}

async function scenarioExecutor(context: AutomationActionContext): Promise<void> {
  const friend = await requireFriend(context);
  const scenarioId = requiredString(context.action.params.scenarioId, 'scenario_id_missing', 'シナリオ');
  const scenario = await context.db.prepare(
    `SELECT s.id FROM scenarios s
      WHERE s.id = ? AND s.line_account_id = ? AND s.is_active = 1
        AND EXISTS (
          SELECT 1 FROM scenario_steps step
          WHERE step.scenario_id = s.id AND step.is_draft = 0
        )`,
  ).bind(scenarioId, context.lineAccountId).first<{ id: string }>();
  if (!scenario) throw invalid('scenario_not_found', '配信できるシナリオが見つかりません');

  const existing = await context.db.prepare(
    `SELECT id FROM friend_scenarios
      WHERE friend_id = ? AND scenario_id = ? AND status IN ('active', 'delivering') LIMIT 1`,
  ).bind(friend.id, scenario.id).first<{ id: string }>();
  if (existing) return;

  // 既存の登録規則（並行可否、初回配信日時）を保つため、DBヘルパーを使う。
  const { enrollFriendInScenario } = await import('@line-crm/db');
  const enrolled = await enrollFriendInScenario(context.db, friend.id, scenario.id);
  if (!enrolled) throw invalid('scenario_enrollment_rejected', 'シナリオの開始条件を満たしていません');
}

async function changeScenarioStatus(
  context: AutomationActionContext,
  operation: 'stop' | 'resume',
): Promise<void> {
  const friend = await requireFriend(context);
  const scenarioId = requiredString(context.action.params.scenarioId, 'scenario_id_missing', 'シナリオ');
  const scenario = await context.db.prepare(
    `SELECT id FROM scenarios WHERE id = ? AND line_account_id = ?`,
  ).bind(scenarioId, context.lineAccountId).first<{ id: string }>();
  if (!scenario) throw invalid('scenario_not_found', 'シナリオが見つかりません');
  const from = operation === 'stop' ? "('active', 'delivering')" : "('paused')";
  const to = operation === 'stop' ? 'paused' : 'active';
  await context.db.prepare(
    `UPDATE friend_scenarios SET status = ?, updated_at = ?
      WHERE friend_id = ? AND scenario_id = ? AND status IN ${from}`,
  ).bind(to, jstNow(), friend.id, scenario.id).run();
}

async function sendMessageExecutor(
  context: AutomationActionContext,
  dependencies: AutomationActionExecutorDependencies,
): Promise<{ output: Record<string, unknown> }> {
  const friend = await requireFriend(context);
  const { message, content } = await resolveMessage(context);
  const payload = JSON.stringify({ to: friend.line_user_id, messages: [message] });
  if (await reserveLineOperation(context, payload) === 'replay') {
    return { output: { replayed: true } };
  }
  try {
    const token = await resolveAccessToken(context, dependencies);
    const client = (dependencies.createLineClient ?? ((value) => new LineClient(value)))(token);
    const response = await client.pushMessage(friend.line_user_id, [message], context.idempotencyKey);
    const now = dependencies.now?.() ?? jstNow();
    const logId = crypto.randomUUID();
    const source = context.inputEvent.source === 'friend_bulk_run' ? 'friend_bulk_run' : 'automation_v6';
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO messages_log
           (id, friend_id, direction, message_type, content, broadcast_id,
            scenario_step_id, delivery_type, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'push', ?, ?, ?)`,
      ).bind(logId, friend.id, message.type, content, source, context.lineAccountId, now),
      completeOutboundSendStatement(context.db, {
        key: context.idempotencyKey,
        responseId: responseId(response, context.stepExecutionId),
        now,
      }),
    ]);
    return { output: { messageLogId: logId, replayed: false } };
  } catch (error) {
    throw classifyLineError(error);
  }
}

function responseId(response: unknown, fallback: string): string {
  if (response && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    for (const key of ['requestId', 'sentMessageId', 'messageId']) {
      if (typeof record[key] === 'string' && record[key]) return record[key] as string;
    }
  }
  return fallback;
}

async function resolveRichMenuId(context: AutomationActionContext): Promise<string> {
  const supplied = context.action.params.richMenuPageId ?? context.action.params.richMenuId;
  const id = requiredString(supplied, 'rich_menu_id_missing', 'リッチメニュー');
  const page = await context.db.prepare(
    `SELECT p.line_richmenu_id
       FROM rich_menu_pages p
       JOIN rich_menu_groups g ON g.id = p.group_id
      WHERE (p.id = ? OR p.line_richmenu_id = ?)
        AND g.account_id = ? AND g.status = 'published'
        AND p.line_richmenu_id IS NOT NULL
      LIMIT 1`,
  ).bind(id, id, context.lineAccountId).first<{ line_richmenu_id: string }>();
  if (!page) throw invalid('rich_menu_not_found', '公開済みのリッチメニューが見つかりません');
  return page.line_richmenu_id;
}

async function richMenuExecutor(
  context: AutomationActionContext,
  dependencies: AutomationActionExecutorDependencies,
  operation: 'link' | 'unlink',
): Promise<{ output: Record<string, unknown> }> {
  const friend = await requireFriend(context);
  const richMenuId = operation === 'link' ? await resolveRichMenuId(context) : null;
  const payload = JSON.stringify({ userId: friend.line_user_id, operation, richMenuId });
  if (await reserveLineOperation(context, payload) === 'replay') {
    return { output: { replayed: true } };
  }
  try {
    const token = await resolveAccessToken(context, dependencies);
    const client = (dependencies.createLineClient ?? ((value) => new LineClient(value)))(token);
    if (operation === 'link') {
      await client.linkRichMenuToUser(friend.line_user_id, richMenuId!);
    } else {
      await client.unlinkRichMenuFromUser(friend.line_user_id);
    }
    await completeLineOperation(context, context.stepExecutionId);
    return { output: { replayed: false } };
  } catch (error) {
    throw classifyLineError(error);
  }
}

function isSafeWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (
      host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || host.endsWith('.internal')
    ) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return false;
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every(Number.isInteger)) {
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
    }
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
    return true;
  } catch {
    return false;
  }
}

async function signBody(secret: string, body: string): Promise<string> {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', bytes.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, bytes.encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function webhookExecutor(
  context: AutomationActionContext,
  dependencies: AutomationActionExecutorDependencies,
): Promise<{ output: Record<string, unknown> }> {
  const webhookId = requiredString(context.action.params.webhookId, 'webhook_id_missing', '送信Webhook');
  await requireScopedResource(context, {
    table: 'outgoing_webhooks', id: webhookId, code: 'webhook_not_found', label: '送信Webhook',
  });
  const webhook = await context.db.prepare(
    `SELECT id, url, secret FROM outgoing_webhooks
      WHERE id = ? AND line_account_id = ? AND is_active = 1`,
  ).bind(webhookId, context.lineAccountId).first<{ id: string; url: string; secret: string | null }>();
  if (!webhook) throw invalid('webhook_not_active', '動作中の送信Webhookが見つかりません');
  if (!isSafeWebhookUrl(webhook.url)) throw invalid('webhook_url_unsafe', '送信WebhookのURLが安全ではありません');

  const body = JSON.stringify({
    eventId: context.sourceEventId,
    friendId: context.friendId,
    data: context.inputEvent,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': context.idempotencyKey,
  };
  if (webhook.secret) headers['X-Webhook-Signature'] = await signBody(webhook.secret, body);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(webhook.url, {
      method: 'POST', headers, body, signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    await recordDeliveryOutcome(context.db, webhook.id, false);
    throw new AutomationActionError(
      'webhook_connection_failed',
      error instanceof Error ? error.message : '送信Webhookへ接続できませんでした',
      true,
    );
  }
  if (!response.ok) {
    await recordDeliveryOutcome(context.db, webhook.id, false);
    throw new AutomationActionError(
      'webhook_rejected',
      `送信WebhookがHTTP ${response.status}を返しました`,
      response.status === 429 || response.status >= 500,
    );
  }
  await recordDeliveryOutcome(context.db, webhook.id, true);
  return { output: { status: response.status } };
}

export function createAutomationActionExecutors(
  dependencies: AutomationActionExecutorDependencies = {},
): Record<string, AutomationActionExecutor> {
  return {
    add_tag: (context) => tagExecutor(context, 'add'),
    remove_tag: (context) => tagExecutor(context, 'remove'),
    set_metadata: metadataExecutor,
    set_support_mark: (context) => supportMarkExecutor(context, dependencies),
    start_scenario: scenarioExecutor,
    stop_scenario: (context) => changeScenarioStatus(context, 'stop'),
    resume_scenario: (context) => changeScenarioStatus(context, 'resume'),
    send_message: (context) => sendMessageExecutor(context, dependencies),
    send_webhook: (context) => webhookExecutor(context, dependencies),
    switch_rich_menu: (context) => richMenuExecutor(context, dependencies, 'link'),
    remove_rich_menu: (context) => richMenuExecutor(context, dependencies, 'unlink'),
  };
}
