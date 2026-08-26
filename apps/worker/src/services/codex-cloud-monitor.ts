import type { Env } from '../index.js';
import {
  processCodexAutoMerge,
  type CodexAutoMergeMessage,
} from './codex-auto-merge.js';
import { decodeSlackTextEntities } from './slack-text.js';

const AUTO_RELAY_MARKER = '【Claude依頼の自動中継】';
const RELAY_RECEIPT_WAIT_SECONDS = 300;

export type CodexMonitorStatus =
  | 'detected'
  | 'official_running'
  | 'official_failed'
  | 'fallback_starting'
  | 'fallback_running'
  | 'fallback_suspended'
  | 'duplicate_risk'
  | 'completed'
  | 'failed';

export type CodexMentionQueueMessage =
  | CodexAutoMergeMessage
  | {
      kind: 'inspect_official';
      slackEventId: string;
      teamId: string;
      channelId: string;
      messageTs: string;
      threadTs: string;
      requesterUserId: string;
      prompt: string;
    }
  | {
      kind: 'inspect_relay';
      slackEventId: string;
      channelId: string;
      threadTs: string;
    }
  | {
      kind: 'notify_duplicate';
      slackEventId: string;
      channelId: string;
      threadTs: string;
      officialTaskUrl?: string;
    };

export type SlackEventEnvelope = {
  type?: string;
  challenge?: string;
  event_id?: string;
  team_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
};

type MonitorRow = {
  slack_event_id: string;
  channel_id: string;
  message_ts: string;
  thread_ts: string;
  status: CodexMonitorStatus;
  official_task_url: string | null;
  fallback_run_id: string | null;
  fallback_conversation_url: string | null;
};

type SlackRepliesResponse = {
  ok?: boolean;
  error?: string;
  messages?: Array<{
    user?: string;
    text?: string;
  }>;
};

type SlackChannelInfoResponse = {
  ok?: boolean;
  channel?: {
    name?: string;
    is_archived?: boolean;
  };
};

export function hasActualSlackMention(text: string, userId: string): boolean {
  return slackMentionPattern(userId).test(text);
}

function slackMentionPattern(userId: string, flags = ''): RegExp {
  const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<@${escapedUserId}(?:\\|[^>]+)?>`, flags);
}

export function isAutomaticCodexRelay(text: string): boolean {
  return text.includes(AUTO_RELAY_MARKER);
}

export function hasClaudeToCodexMarker(text: string): boolean {
  const firstLine = decodeSlackTextEntities(text).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return firstLine.trimStart().startsWith('[claude->codex]');
}

export function isAllowedRelaySource(configuredIds: string | undefined, userId: string): boolean {
  if (!configuredIds) return false;
  return configuredIds
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(userId);
}

function configuredRelayValues(value: string | undefined): string[] {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasConfiguredRelayChannelGate(
  configuredIds: string | undefined,
  configuredPrefixes: string | undefined,
): boolean {
  return configuredRelayValues(configuredIds).length > 0 ||
    configuredRelayValues(configuredPrefixes).length > 0;
}

/**
 * Exact channel IDs are accepted without a network request. Range channels
 * may instead be admitted by a fail-closed range-name check against Slack's
 * authoritative conversations.info response.
 */
export async function isAllowedRelayChannel(
  config: Pick<Env['Bindings'],
    'SLACK_BOT_TOKEN' | 'CODEX_ALLOWED_CHANNEL_IDS' | 'CODEX_ALLOWED_CHANNEL_NAME_PREFIXES'>,
  channelId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (isAllowedRelaySource(config.CODEX_ALLOWED_CHANNEL_IDS, channelId)) return true;
  const allowedPrefixes = configuredRelayValues(config.CODEX_ALLOWED_CHANNEL_NAME_PREFIXES);
  if (!config.SLACK_BOT_TOKEN || allowedPrefixes.length === 0) return false;

  try {
    const query = new URLSearchParams({ channel: channelId });
    const response = await fetcher(`https://slack.com/api/conversations.info?${query}`, {
      headers: { authorization: `Bearer ${config.SLACK_BOT_TOKEN}` },
    });
    const result = await response.json<SlackChannelInfoResponse>();
    const name = result.channel?.name;
    return response.ok && result.ok === true && result.channel?.is_archived !== true &&
      typeof name === 'string' && allowedPrefixes.some((prefix) =>
        new RegExp(`^${escapeRegExp(prefix)}\\d{3}-\\d{3}$`).test(name));
  } catch {
    return false;
  }
}

export function isCodexRelayEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function shouldStopCodexQueueRetry(
  attempts: number,
  configuredMax: string | undefined,
): boolean {
  const parsed = Number.parseInt(configuredMax ?? '5', 10);
  const maxAttempts = Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 5;
  return attempts >= maxAttempts;
}

export type CodexMonitorErrorClassification = 'db_error' | 'slack_api_error' | 'unknown';

export function createCodexQueueFailureLog(input: {
  kind: string;
  slackEventId: string;
  reason: CodexMonitorErrorClassification;
  attempts: number;
  stopped: boolean;
}) {
  return {
    event: 'codex_cloud_monitor_queue_failed',
    ...input,
  };
}

/** Never persist or log exception bodies; reduce them to an operational class. */
export function classifyCodexMonitorError(error: unknown): CodexMonitorErrorClassification {
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  } | null;
  const name = typeof candidate?.name === 'string' ? candidate.name.toLowerCase() : '';
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';
  const status = candidate?.status ?? candidate?.statusCode;
  if (
    name.includes('d1') ||
    name.includes('sqlite') ||
    message.includes('d1_error') ||
    message.includes('sqlite')
  ) return 'db_error';
  if (
    name.includes('slack') ||
    message.includes('slack_') ||
    message.includes('slack api') ||
    (typeof status === 'number' && status >= 400 && status <= 599)
  ) return 'slack_api_error';
  return 'unknown';
}

export function requiresExplicitApproval(text: string): boolean {
  const risky = /(?:\bmain\b|本番|production|prod\b|DB(?:更新|変更|削除|移行)|データベース(?:更新|変更|削除|移行)|\bDELETE\b|\bDROP\b|削除してください|配備|deploy|\.env|環境変数|Webhook|OAuth|Cron|外部通信|決済|返金|秘密(?:値|情報)|API(?:キー| key)|トークン)/i;
  const explicitlyExcluded = /(?:しない|行わない|加えない|含まない|不要|対象外|禁止|承認後|承認を得てから|変更なし)/i;
  return text
    .split(/[。\n、,；;]/)
    .some((clause) => risky.test(clause) && !explicitlyExcluded.test(clause));
}

export function extractChatGptTaskUrl(text: string): string | undefined {
  const match = text.match(/https:\/\/chatgpt\.com\/(?:s|c)\/[A-Za-z0-9_-]+/i);
  return match?.[0];
}

export function classifyOfficialCodexMessage(text: string): {
  state: 'running' | 'failed' | 'completed' | 'unknown';
  taskUrl?: string;
} {
  const taskUrl = extractChatGptTaskUrl(text);
  if (/(?:接続|環境(?:の)?選択|environment|connection).{0,40}(?:エラー|失敗|できません|failed|error)|(?:停止|失敗しました|stopped|failed|unable to|couldn['’]t)/i.test(text)) {
    return { state: 'failed', taskUrl };
  }
  if (/(?:完了しました|対応完了|completed|finished|task is complete|done[.!\s])/i.test(text)) {
    return { state: 'completed', taskUrl };
  }
  if (taskUrl || /(?:着手|開始しました|実行中|on it|kicked off|working on)/i.test(text)) {
    return { state: 'running', taskUrl };
  }
  return { state: 'unknown', taskUrl };
}

export function parseSlackEventEnvelope(rawBody: string): SlackEventEnvelope | null {
  try {
    const value = JSON.parse(rawBody) as SlackEventEnvelope;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export async function recordSlackMention(
  db: D1Database,
  message: Extract<CodexMentionQueueMessage, { kind: 'inspect_official' }>,
): Promise<boolean> {
  const result = await db.prepare(`
    INSERT INTO codex_cloud_tasks (
      slack_event_id, team_id, channel_id, message_ts, thread_ts,
      requester_user_id, status, detected_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'detected', datetime('now'), datetime('now'))
    ON CONFLICT(channel_id, message_ts) DO NOTHING
  `).bind(
    message.slackEventId,
    message.teamId,
    message.channelId,
    message.messageTs,
    message.threadTs,
    message.requesterUserId,
  ).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function markCodexMentionFailed(
  db: D1Database,
  slackEventId: string,
): Promise<void> {
  await db.prepare(`
    UPDATE codex_cloud_tasks
       SET status = 'failed', updated_at = datetime('now')
     WHERE slack_event_id = ? AND status NOT IN ('completed', 'official_running')
  `).bind(slackEventId).run();
}

async function getMonitorRow(db: D1Database, slackEventId: string): Promise<MonitorRow | null> {
  return db.prepare(`
    SELECT slack_event_id, channel_id, message_ts, thread_ts, status,
           official_task_url, fallback_run_id, fallback_conversation_url
      FROM codex_cloud_tasks
     WHERE slack_event_id = ?
  `).bind(slackEventId).first<MonitorRow>();
}

export async function observeOfficialCodexReply(
  env: Env['Bindings'],
  channelId: string,
  threadTs: string,
  text: string,
): Promise<{ tracked: boolean; duplicateRisk: boolean; taskUrl?: string }> {
  const classification = classifyOfficialCodexMessage(text);
  if (classification.state === 'unknown') {
    return { tracked: false, duplicateRisk: false, taskUrl: classification.taskUrl };
  }
  const row = await env.DB.prepare(`
    SELECT slack_event_id, status
      FROM codex_cloud_tasks
     WHERE channel_id = ? AND thread_ts = ?
     ORDER BY detected_at DESC
     LIMIT 1
  `).bind(channelId, threadTs).first<{ slack_event_id: string; status: CodexMonitorStatus }>();
  if (!row) return { tracked: false, duplicateRisk: false, taskUrl: classification.taskUrl };

  // fallback_running means that the user-authored relay was posted and the
  // official Codex receipt is the expected next event, not a duplicate run.
  const duplicateRisk = false;
  const nextStatus: CodexMonitorStatus = classification.state === 'failed'
    ? 'official_failed'
    : classification.state === 'completed'
      ? 'completed'
      : 'official_running';
  await env.DB.prepare(`
    UPDATE codex_cloud_tasks
       SET status = ?,
           official_task_url = COALESCE(?, official_task_url),
           updated_at = datetime('now')
     WHERE slack_event_id = ?
  `).bind(nextStatus, classification.taskUrl ?? null, row.slack_event_id).run();

  return {
    tracked: true,
    duplicateRisk,
    taskUrl: classification.taskUrl,
  };
}

async function inspectOfficialCodexThread(
  env: Env['Bindings'],
  channelId: string,
  threadTs: string,
): Promise<ReturnType<typeof classifyOfficialCodexMessage>> {
  if (!env.SLACK_USER_TOKEN || !env.CODEX_SLACK_USER_ID) {
    throw new Error('SLACK_THREAD_RECHECK_NOT_CONFIGURED');
  }
  const query = new URLSearchParams({
    channel: channelId,
    ts: threadTs,
    inclusive: 'true',
    limit: '100',
  });
  const response = await fetch(`https://slack.com/api/conversations.replies?${query}`, {
    headers: { authorization: `Bearer ${env.SLACK_USER_TOKEN}` },
  });
  const result = await response.json<SlackRepliesResponse>();
  if (!response.ok || result.ok !== true) {
    throw new Error(`SLACK_THREAD_RECHECK_FAILED:${result.error ?? response.status}`);
  }

  let latest: ReturnType<typeof classifyOfficialCodexMessage> = { state: 'unknown' };
  for (const message of result.messages ?? []) {
    if (message.user !== env.CODEX_SLACK_USER_ID || typeof message.text !== 'string') continue;
    const classification = classifyOfficialCodexMessage(message.text);
    if (classification.state !== 'unknown') latest = classification;
  }
  return latest;
}

async function postSlackThread(
  env: Env['Bindings'],
  channelId: string,
  threadTs: string,
  text: string,
): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN_MISSING');
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: threadTs,
      text,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const result = await response.json<{ ok?: boolean; error?: string }>();
  if (!response.ok || result.ok !== true) {
    throw new Error(`SLACK_POST_FAILED:${result.error ?? response.status}`);
  }
}

async function postSlackThreadAsUser(
  env: Env['Bindings'],
  channelId: string,
  threadTs: string,
  text: string,
): Promise<void> {
  if (!env.SLACK_USER_TOKEN) throw new Error('SLACK_USER_TOKEN_MISSING');
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.SLACK_USER_TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: threadTs,
      text,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const result = await response.json<{ ok?: boolean; error?: string }>();
  if (!response.ok || result.ok !== true) {
    throw new Error(`SLACK_USER_RELAY_FAILED:${result.error ?? response.status}`);
  }
}

function relayText(
  message: Extract<CodexMentionQueueMessage, { kind: 'inspect_official' }>,
  codexUserId: string,
): string {
  const withoutMarker = message.prompt.split(/\r?\n/).slice(1).join('\n');
  const original = withoutMarker.replace(slackMentionPattern(codexUserId, 'g'), '').trim();
  return [
    AUTO_RELAY_MARKER,
    `<@${codexUserId}> 以下は許可済みのClaude投稿を、MasatoのUser OAuthで同じスレッドへ中継した依頼です。`,
    `元投稿者: <@${message.requesterUserId}>`,
    '',
    original,
    '',
    'GitHub Issue・仕様書・PRとリポジトリのAGENTS.mdを正本としてください。',
    '通常のコード変更は専用ブランチで実装・検証し、codex/development宛ての下書きPRまで進めてください。',
    'この自動中継はmain統合、本番変更、DB更新、配備、外部設定変更、秘密情報の操作を承認するものではありません。該当する場合は作業せず、このスレッドでMasatoの承認を求めてください。',
  ].join('\n');
}

async function transitionStatus(
  db: D1Database,
  slackEventId: string,
  nextStatus: CodexMonitorStatus,
  fields: { runId?: string; conversationUrl?: string } = {},
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE codex_cloud_tasks
       SET status = ?,
           fallback_run_id = COALESCE(?, fallback_run_id),
           fallback_conversation_url = COALESCE(?, fallback_conversation_url),
           updated_at = datetime('now')
     WHERE slack_event_id = ? AND status <> ?
  `).bind(
    nextStatus,
    fields.runId ?? null,
    fields.conversationUrl ?? null,
    slackEventId,
    nextStatus,
  ).run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function claimFallbackStart(db: D1Database, slackEventId: string): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE codex_cloud_tasks
       SET status = 'fallback_starting', updated_at = datetime('now')
     WHERE slack_event_id = ? AND status IN ('detected', 'official_failed')
  `).bind(slackEventId).run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function releaseFallbackStart(db: D1Database, slackEventId: string): Promise<void> {
  await db.prepare(`
    UPDATE codex_cloud_tasks
       SET status = 'detected', updated_at = datetime('now')
     WHERE slack_event_id = ? AND status = 'fallback_starting'
  `).bind(slackEventId).run();
}

async function finishFallbackStart(
  db: D1Database,
  slackEventId: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE codex_cloud_tasks
       SET status = 'fallback_running',
           updated_at = datetime('now')
     WHERE slack_event_id = ? AND status = 'fallback_starting'
  `).bind(slackEventId).run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function processOfficialInspection(
  env: Env['Bindings'],
  message: Extract<CodexMentionQueueMessage, { kind: 'inspect_official' }>,
): Promise<void> {
  const row = await getMonitorRow(env.DB, message.slackEventId);
  if (!row || row.status === 'official_running' || row.status === 'completed' || row.status === 'duplicate_risk') {
    return;
  }
  if (row.status === 'fallback_running') {
    // If the producer response was lost after the user relay succeeded, the
    // original message may be retried. Recreate only the idempotent receipt
    // inspection; never post the user relay a second time.
    await env.CODEX_MENTION_QUEUE?.send({
      kind: 'inspect_relay',
      slackEventId: message.slackEventId,
      channelId: message.channelId,
      threadTs: message.threadTs,
    }, { delaySeconds: RELAY_RECEIPT_WAIT_SECONDS });
    return;
  }
  if (
    row.status === 'fallback_starting' ||
    row.status === 'fallback_suspended'
  ) return;

  if (
    !env.SLACK_USER_TOKEN ||
    !env.CODEX_SLACK_USER_ID ||
    !env.CODEX_ALLOWED_TEAM_IDS ||
    !hasConfiguredRelayChannelGate(
      env.CODEX_ALLOWED_CHANNEL_IDS,
      env.CODEX_ALLOWED_CHANNEL_NAME_PREFIXES,
    ) ||
    !env.CODEX_RELAY_SOURCE_USER_IDS
  ) {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'failed');
    if (changed) {
      await postSlackThread(
        env,
        message.channelId,
        message.threadTs,
        '【設定待ち】公式Slack Codexの受領を確認できませんでしたが、Slack User OAuth中継の設定が未完了のため自動中継せず停止しました。',
      );
    }
    return;
  }

  if (!isCodexRelayEnabled(env.CODEX_RELAY_ENABLED)) {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'failed');
    if (changed) {
      await postSlackThread(
        env,
        message.channelId,
        message.threadTs,
        '【自動中継停止中】キルスイッチが無効のため、公式Codexへ中継せず停止しました。',
      );
    }
    return;
  }

  if (
    !isAllowedRelaySource(env.CODEX_ALLOWED_TEAM_IDS, message.teamId) ||
    !await isAllowedRelayChannel(env, message.channelId) ||
    !isAllowedRelaySource(env.CODEX_RELAY_SOURCE_USER_IDS, message.requesterUserId) ||
    !hasClaudeToCodexMarker(message.prompt)
  ) {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'failed');
    if (changed) {
      await postSlackThread(
        env,
        message.channelId,
        message.threadTs,
        '【中継対象外】許可されたworkspace、channel、投稿者、または `[claude->codex]` マーカーの条件を満たさないため、公式Codexへ中継せず停止しました。',
      );
    }
    return;
  }

  if (requiresExplicitApproval(message.prompt)) {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'fallback_suspended');
    if (changed) {
      await postSlackThread(
        env,
        message.channelId,
        message.threadTs,
        '【承認待ち】本番、DB、配備、外部設定、秘密情報など明示承認が必要な可能性を検知したため、自動中継せず停止しました。対象・影響・実施範囲を確認してMasatoが承認してください。',
      );
    }
    return;
  }

  const claimed = await claimFallbackStart(env.DB, message.slackEventId);
  if (!claimed) return;

  let receipt: ReturnType<typeof classifyOfficialCodexMessage>;
  try {
    receipt = await inspectOfficialCodexThread(env, message.channelId, message.threadTs);
  } catch (error) {
    await releaseFallbackStart(env.DB, message.slackEventId);
    throw error;
  }
  if (receipt.state === 'running' || receipt.state === 'completed') {
    await env.DB.prepare(`
      UPDATE codex_cloud_tasks
         SET status = ?,
             official_task_url = COALESCE(?, official_task_url),
             updated_at = datetime('now')
       WHERE slack_event_id = ? AND status = 'fallback_starting'
    `).bind(
      receipt.state === 'completed' ? 'completed' : 'official_running',
      receipt.taskUrl ?? null,
      message.slackEventId,
    ).run();
    return;
  }

  const latest = await getMonitorRow(env.DB, message.slackEventId);
  if (!latest || latest.status !== 'fallback_starting') return;

  const started = await finishFallbackStart(env.DB, message.slackEventId);
  if (!started) return;

  try {
    await postSlackThreadAsUser(
      env,
      message.channelId,
      message.threadTs,
      relayText(message, env.CODEX_SLACK_USER_ID),
    );
  } catch (error) {
    await transitionStatus(env.DB, message.slackEventId, 'failed');
    await postSlackThread(
      env,
      message.channelId,
      message.threadTs,
      '【中継失敗】Slack User OAuthによる公式Codexへの自動中継に失敗しました。重複防止のため再送せず停止しています。',
    );
    console.error(JSON.stringify({
      event: 'codex_user_relay_failed',
      slackEventId: message.slackEventId,
      reason: classifyCodexMonitorError(error),
    }));
    return;
  }

  await env.CODEX_MENTION_QUEUE?.send({
    kind: 'inspect_relay',
    slackEventId: message.slackEventId,
    channelId: message.channelId,
    threadTs: message.threadTs,
  }, { delaySeconds: RELAY_RECEIPT_WAIT_SECONDS });
}

async function processRelayInspection(
  env: Env['Bindings'],
  message: Extract<CodexMentionQueueMessage, { kind: 'inspect_relay' }>,
): Promise<void> {
  const row = await getMonitorRow(env.DB, message.slackEventId);
  if (!row || row.status !== 'fallback_running') return;

  const receipt = await inspectOfficialCodexThread(env, message.channelId, message.threadTs);
  if (receipt.state === 'running' || receipt.state === 'completed') {
    await env.DB.prepare(`
      UPDATE codex_cloud_tasks
         SET status = ?,
             official_task_url = COALESCE(?, official_task_url),
             updated_at = datetime('now')
       WHERE slack_event_id = ? AND status = 'fallback_running'
    `).bind(
      receipt.state === 'completed' ? 'completed' : 'official_running',
      receipt.taskUrl ?? null,
      message.slackEventId,
    ).run();
    return;
  }

  const nextStatus: CodexMonitorStatus = receipt.state === 'failed' ? 'official_failed' : 'failed';
  const changed = await transitionStatus(env.DB, message.slackEventId, nextStatus);
  if (!changed) return;
  await postSlackThread(
    env,
    message.channelId,
    message.threadTs,
    receipt.state === 'failed'
      ? '【公式Codex失敗】自動中継後に公式Slack Codexの失敗返信を検知しました。再中継せず停止しています。'
      : '【受領未確認】自動中継後5分以内に公式Slack Codexのタスクリンク、着手返信、完了返信を確認できませんでした。重複防止のため再中継せず停止しています。',
  );
}

export async function processCodexMentionMessage(
  env: Env['Bindings'],
  message: CodexMentionQueueMessage,
): Promise<void> {
  if (message.kind === 'auto_merge') {
    await processCodexAutoMerge(env, message);
    return;
  }
  if (message.kind === 'inspect_official') {
    await processOfficialInspection(env, message);
    return;
  }
  if (message.kind === 'inspect_relay') {
    await processRelayInspection(env, message);
    return;
  }
  await postSlackThread(
    env,
    message.channelId,
    message.threadTs,
    `【二重実行リスク】ローカル／クラウドフォールバック開始後に公式Slack Codexの受領を検知しました。安全な区切りで状態を確認してください。${message.officialTaskUrl ? `\n<${message.officialTaskUrl}|公式Codexタスクを確認>` : ''}`,
  );
}
