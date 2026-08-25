import type { Env } from '../index.js';

const CHATGPT_API_BASE = 'https://api.chatgpt.com/v1';
const WORKSPACE_AGENT_BETA = 'workspace_agent_runs=v1';
const MAX_RUN_AGE_MS = 24 * 60 * 60 * 1000;

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
      kind: 'inspect_fallback';
      slackEventId: string;
      channelId: string;
      threadTs: string;
      runId: string;
      attempt: number;
      startedAt: string;
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

type WorkspaceAgentTriggerResponse = {
  conversation_url?: string;
  agent_trigger_run_id?: string;
  run_id?: string;
};

type WorkspaceAgentRunResponse = {
  status?: string;
  conversation_url?: string;
};

type SlackRepliesResponse = {
  ok?: boolean;
  error?: string;
  messages?: Array<{
    user?: string;
    text?: string;
  }>;
};

export function hasActualSlackMention(text: string, userId: string): boolean {
  return text.includes(`<@${userId}>`);
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

  const duplicateRisk = row.status === 'fallback_starting' ||
    row.status === 'fallback_running' ||
    row.status === 'fallback_suspended';
  const nextStatus: CodexMonitorStatus = duplicateRisk
    ? 'duplicate_risk'
    : classification.state === 'failed'
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

async function triggerWorkspaceAgent(
  env: Env['Bindings'],
  message: Extract<CodexMentionQueueMessage, { kind: 'inspect_official' }>,
): Promise<WorkspaceAgentTriggerResponse> {
  if (!env.WORKSPACE_AGENT_TRIGGER_ID || !env.WORKSPACE_AGENT_ACCESS_TOKEN) {
    throw new Error('WORKSPACE_AGENT_NOT_CONFIGURED');
  }
  const response = await fetch(
    `${CHATGPT_API_BASE}/workspace_agents/${encodeURIComponent(env.WORKSPACE_AGENT_TRIGGER_ID)}/trigger`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.WORKSPACE_AGENT_ACCESS_TOKEN}`,
        'content-type': 'application/json',
        'idempotency-key': `slack:${message.teamId}:${message.channelId}:${message.messageTs}`,
        'openai-beta': WORKSPACE_AGENT_BETA,
      },
      body: JSON.stringify({
        input: [
          'Slackの公式Codexが有効な受領を返さなかったため、クラウドフォールバックとして依頼を処理してください。',
          `Slack team=${message.teamId} channel=${message.channelId} thread_ts=${message.threadTs}`,
          '依頼本文:',
          message.prompt,
          '変更操作の直前に、同じSlackスレッドに公式Codexのタスクリンクまたは着手返信が増えていないか再確認してください。増えていれば二重実行を避けるため停止し、現在状態だけを報告してください。',
          'GitHub Issue・仕様書・PRとリポジトリのAGENTS.mdを正本とし、承認ゲートを省略しないでください。',
          '完了または承認待ちになった場合は、可能なら元Slackスレッドへ結果を報告してください。',
        ].join('\n'),
        conversation_key: `slack:${message.teamId}:${message.channelId}:${message.threadTs}`,
      }),
    },
  );
  if (response.status !== 202) {
    throw new Error(`WORKSPACE_AGENT_TRIGGER_FAILED:${response.status}`);
  }
  return response.json<WorkspaceAgentTriggerResponse>();
}

async function getWorkspaceAgentRun(
  env: Env['Bindings'],
  runId: string,
): Promise<WorkspaceAgentRunResponse> {
  if (!env.WORKSPACE_AGENT_TRIGGER_ID || !env.WORKSPACE_AGENT_ACCESS_TOKEN) {
    throw new Error('WORKSPACE_AGENT_NOT_CONFIGURED');
  }
  const response = await fetch(
    `${CHATGPT_API_BASE}/workspace_agents/${encodeURIComponent(env.WORKSPACE_AGENT_TRIGGER_ID)}/runs/${encodeURIComponent(runId)}`,
    {
      headers: {
        authorization: `Bearer ${env.WORKSPACE_AGENT_ACCESS_TOKEN}`,
        'openai-beta': WORKSPACE_AGENT_BETA,
      },
    },
  );
  if (!response.ok) throw new Error(`WORKSPACE_AGENT_RUN_FAILED:${response.status}`);
  return response.json<WorkspaceAgentRunResponse>();
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
  runId: string | undefined,
  conversationUrl: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE codex_cloud_tasks
       SET status = 'fallback_running',
           fallback_run_id = COALESCE(?, fallback_run_id),
           fallback_conversation_url = ?,
           updated_at = datetime('now')
     WHERE slack_event_id = ? AND status = 'fallback_starting'
  `).bind(runId ?? null, conversationUrl, slackEventId).run();
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
  if (
    row.status === 'fallback_starting' ||
    row.status === 'fallback_running' ||
    row.status === 'fallback_suspended'
  ) return;

  if (
    !env.WORKSPACE_AGENT_TRIGGER_ID ||
    !env.WORKSPACE_AGENT_ACCESS_TOKEN ||
    !env.SLACK_USER_TOKEN ||
    !env.CODEX_SLACK_USER_ID
  ) {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'failed');
    if (changed) {
      await postSlackThread(
        env,
        message.channelId,
        message.threadTs,
        '【設定待ち】公式Slack Codexの有効な受領を確認できませんでしたが、Workspace Agent API設定が未完了のためフォールバックを開始せず停止しました。',
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

  let trigger: WorkspaceAgentTriggerResponse;
  try {
    trigger = await triggerWorkspaceAgent(env, message);
  } catch (error) {
    await releaseFallbackStart(env.DB, message.slackEventId);
    throw error;
  }
  const runId = trigger.agent_trigger_run_id ?? trigger.run_id;
  const conversationUrl = trigger.conversation_url;
  if (!conversationUrl || !runId) {
    await releaseFallbackStart(env.DB, message.slackEventId);
    throw new Error('WORKSPACE_AGENT_RUN_REFERENCE_MISSING');
  }
  const changed = await finishFallbackStart(
    env.DB,
    message.slackEventId,
    runId,
    conversationUrl,
  );
  if (changed) {
    await postSlackThread(
      env,
      message.channelId,
      message.threadTs,
      `【クラウドフォールバック】公式Slack Codexの有効な受領を確認できなかったため、Workspace Agentを開始しました。\n<${conversationUrl}|ChatGPTで進捗を確認>`,
    );
  } else {
    await transitionStatus(env.DB, message.slackEventId, 'duplicate_risk', {
      runId,
      conversationUrl,
    });
    await postSlackThread(
      env,
      message.channelId,
      message.threadTs,
      `【二重実行リスク】Workspace Agentの起動と同時に公式Slack Codexの受領を検知しました。クラウドタスクは安全な区切りで停止させてください。\n<${conversationUrl}|ChatGPTで状態を確認>`,
    );
  }
  if (changed) {
    await env.CODEX_MENTION_QUEUE?.send({
      kind: 'inspect_fallback',
      slackEventId: message.slackEventId,
      channelId: message.channelId,
      threadTs: message.threadTs,
      runId,
      attempt: 1,
      startedAt: new Date().toISOString(),
    }, { delaySeconds: 60 });
  }
}

async function processFallbackInspection(
  env: Env['Bindings'],
  message: Extract<CodexMentionQueueMessage, { kind: 'inspect_fallback' }>,
): Promise<void> {
  const row = await getMonitorRow(env.DB, message.slackEventId);
  if (!row || row.status === 'completed' || row.status === 'failed' || row.status === 'duplicate_risk') return;
  const result = await getWorkspaceAgentRun(env, message.runId);
  const status = result.status;
  const conversationUrl = result.conversation_url ?? row.fallback_conversation_url;

  if (status === 'completed') {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'completed', {
      conversationUrl: conversationUrl ?? undefined,
    });
    if (changed) {
      await postSlackThread(
        env,
        message.channelId,
        message.threadTs,
        `【クラウドフォールバック】Workspace Agentが完了しました。${conversationUrl ? `\n<${conversationUrl}|実施結果を確認>` : ''}`,
      );
    }
    return;
  }
  if (status === 'failed') {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'failed', {
      conversationUrl: conversationUrl ?? undefined,
    });
    if (changed) {
      await postSlackThread(
        env,
        message.channelId,
        message.threadTs,
        `【クラウドフォールバック】Workspace Agentが失敗しました。再実行せず停止しています。${conversationUrl ? `\n<${conversationUrl}|状態を確認>` : ''}`,
      );
    }
    return;
  }
  if (status === 'suspended') {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'fallback_suspended', {
      conversationUrl: conversationUrl ?? undefined,
    });
    if (changed) {
      await postSlackThread(
        env,
        message.channelId,
        message.threadTs,
        `【承認待ち】Workspace Agentが判断を待っています。${conversationUrl ? `\n<${conversationUrl}|ChatGPTで内容を確認して承認>` : ''}`,
      );
    }
  }
  const startedAt = Date.parse(message.startedAt);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt >= MAX_RUN_AGE_MS) {
    const changed = await transitionStatus(env.DB, message.slackEventId, 'failed');
    if (changed) {
      await postSlackThread(env, message.channelId, message.threadTs, '【クラウドフォールバック】24時間以内に完了を確認できなかったため、監視を停止しました。');
    }
    return;
  }
  await env.CODEX_MENTION_QUEUE?.send({
    ...message,
    attempt: message.attempt + 1,
  }, { delaySeconds: status === 'suspended' ? 300 : 60 });
}

export async function processCodexMentionMessage(
  env: Env['Bindings'],
  message: CodexMentionQueueMessage,
): Promise<void> {
  if (message.kind === 'inspect_official') {
    await processOfficialInspection(env, message);
    return;
  }
  if (message.kind === 'inspect_fallback') {
    await processFallbackInspection(env, message);
    return;
  }
  await postSlackThread(
    env,
    message.channelId,
    message.threadTs,
    `【二重実行リスク】ローカル／クラウドフォールバック開始後に公式Slack Codexの受領を検知しました。安全な区切りで状態を確認してください。${message.officialTaskUrl ? `\n<${message.officialTaskUrl}|公式Codexタスクを確認>` : ''}`,
  );
}
