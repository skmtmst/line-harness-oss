export type CodexSlackCategory = 'error' | 'idea' | 'fix' | 'decision';
export type SlackTaskStatus = 'working' | 'review' | 'done';

export type CodexSlackPrSnapshot = {
  number: number;
  title: string;
  url: string;
  author: string;
  headRefName: string;
  isDraft: boolean;
  mergeStateStatus: string;
  updatedAt: string;
  fileCount: number;
  overlapsWith: number[];
  checks: 'pass' | 'pending' | 'fail' | 'none';
};

export type CodexSlackEvent = {
  version: 1;
  eventId: string;
  eventType: 'prompt_submitted' | 'turn_completed' | 'approval_required';
  sessionId: string;
  turnId?: string;
  operator: 'kenta' | 'masato' | 'codex';
  repository?: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  content: string;
  occurredAt: string;
  explicitCategory?: CodexSlackCategory;
  openPrs?: CodexSlackPrSnapshot[];
  eventSource?: 'codex' | 'github';
  syncMode?: 'event' | 'reconcile';
  refreshCommandCenter?: boolean;
};

export type CodexSlackRelayConfig = {
  SLACK_BOT_TOKEN?: string;
  SLACK_COMMAND_CHANNEL_ID?: string;
  SLACK_ERROR_CHANNEL_ID?: string;
  SLACK_IDEA_CHANNEL_ID?: string;
  SLACK_DEFAULT_PR_CHANNEL_ID?: string;
  SLACK_PR_CHANNELS_JSON?: string;
  SLACK_KENTA_USER_ID?: string;
  SLACK_MASATO_USER_ID?: string;
  SLACK_TASK_CHANNEL_ID?: string;
};

type SlackMessage = {
  ts?: string;
  text?: string;
  blocks?: Array<Record<string, unknown>>;
  metadata?: {
    event_type?: string;
    event_payload?: Record<string, string>;
  };
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  ts?: string;
  permalink?: string;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

const THREAD_METADATA_TYPE = 'line_harness_codex';
const TASK_METADATA_TYPE = 'line_harness_task';
const COMMAND_CENTER_METADATA_TYPE = 'line_harness_command_center';
export const TASK_ACTION_ID = 'line_harness_task_status';
const MAX_HISTORY_PAGES = 5;
const MAX_SLACK_CONTENT_LENGTH = 2_500;

const ERROR_PATTERN = /(エラー|白(?:い)?画面|例外|失敗|動かない|できない|不具合|クラッシュ|競合|conflict|error|exception|failed|failure|crash)/i;
const IDEA_PATTERN = /(アイデア|改善案|提案|思いつ|将来案|検討案|こうしたい|正本化|idea|proposal|suggestion)/i;
const FIX_PATTERN = /(修正|直して|対応|実装|変更|作って|追加|更新|レビュー|PR\s*#?\d+|fix|implement|update|review)/i;
const TRACKABLE_DECISION_PATTERN = /(要対応|確認|承認|判断|保留|待ち|競合|できない|blocked|approval|decision)/i;
const TRACKABLE_IDEA_PATTERN = /(正本化|実装|追加|作って|対応|検討|issue|spec)/i;
const COMPLETION_PATTERN = /(?:作業|対応|修正|実装|タスク|PR|マージ).{0,20}(?:完了|終了|統合済み)|(?:完了しました|対応済み|修正済み|マージ済み|統合しました)/i;
const INCOMPLETE_PATTERN = /(未完了|未対応|完了していない|残作業|残っています|blocked|失敗)/i;

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function sanitizeSlackContent(value: string): string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g, '[REDACTED_TOKEN]')
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, MAX_SLACK_CONTENT_LENGTH)
    .trim();
}

export function classifyCodexSlackEvent(event: CodexSlackEvent): CodexSlackCategory {
  if (event.explicitCategory) return event.explicitCategory;
  if (event.eventType === 'approval_required') return 'decision';
  if (event.prNumber) return 'fix';
  if (ERROR_PATTERN.test(event.content)) return 'error';
  if (IDEA_PATTERN.test(event.content)) return 'idea';
  if (FIX_PATTERN.test(event.content)) return 'fix';
  return 'decision';
}

export function shouldTrackCodexTask(event: CodexSlackEvent, category: CodexSlackCategory): boolean {
  if (event.eventType === 'approval_required') return true;
  if (category === 'error' || category === 'fix') return true;
  if (category === 'idea') return TRACKABLE_IDEA_PATTERN.test(event.content);
  return TRACKABLE_DECISION_PATTERN.test(event.content);
}

export function isCodexTaskCompletion(event: CodexSlackEvent): boolean {
  return event.eventType === 'turn_completed' &&
    !INCOMPLETE_PATTERN.test(event.content) &&
    COMPLETION_PATTERN.test(event.content);
}

export function prRangeKey(prNumber: number): string {
  const start = Math.floor((Math.max(1, prNumber) - 1) / 100) * 100 + 1;
  return `${start}-${start + 99}`;
}

function parsePrChannels(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

export function resolveCodexSlackChannel(
  config: CodexSlackRelayConfig,
  category: CodexSlackCategory,
  prNumber?: number,
): string | null {
  if (category === 'error') return config.SLACK_ERROR_CHANNEL_ID || null;
  if (category === 'idea') return config.SLACK_IDEA_CHANNEL_ID || null;
  if (category === 'decision') return config.SLACK_COMMAND_CHANNEL_ID || null;
  if (prNumber) {
    const mapped = parsePrChannels(config.SLACK_PR_CHANNELS_JSON)[prRangeKey(prNumber)];
    if (mapped) return mapped;
  }
  return config.SLACK_DEFAULT_PR_CHANNEL_ID || config.SLACK_COMMAND_CHANNEL_ID || null;
}

function workKey(event: CodexSlackEvent): string {
  if (event.prNumber) return `pr:${event.prNumber}`;
  if (event.branch && !['main', 'master', 'codex/development'].includes(event.branch)) {
    return `branch:${event.repository || 'repo'}:${event.branch}`;
  }
  return `session:${event.sessionId}`;
}

export function taskIdForKey(key: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= BigInt(key.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `TASK-${hash.toString(16).toUpperCase().padStart(16, '0')}`;
}

function taskIdFromContent(content: string): string | null {
  return content.match(/\bTASK-[0-9A-F]{16}\b/i)?.[0]?.toUpperCase() || null;
}

function operatorLabel(operator: CodexSlackEvent['operator']): string {
  if (operator === 'kenta') return 'ケンタ';
  if (operator === 'masato') return 'マサト';
  return 'Codex';
}

function categoryLabel(category: CodexSlackCategory): string {
  if (category === 'error') return ':warning: エラー報告';
  if (category === 'idea') return ':bulb: アイデア';
  if (category === 'fix') return ':large_blue_circle: 修正・開発';
  return ':question: 判断待ち';
}

function taskStatusLabel(status: Exclude<SlackTaskStatus, 'done'>): string {
  return status === 'working' ? ':large_blue_circle: 作業中' : ':eyes: 確認待ち';
}

function errorParentStatusLabel(status: SlackTaskStatus): string {
  return status === 'done' ? ':white_check_mark: 完了' : taskStatusLabel(status);
}

export function replaceErrorParentStatusText(text: string, status: SlackTaskStatus): string {
  const withoutOldStatus = text.replace(/\n状態：[^\n]*/g, '');
  const statusLine = `状態：${errorParentStatusLabel(status)}`;
  const threadGuide = '\n\n以降の確認・会話・Codexへの依頼は、このスレッドへ返信してください。';
  if (withoutOldStatus.includes(threadGuide)) {
    return withoutOldStatus.replace(threadGuide, `\n${statusLine}${threadGuide}`);
  }
  return `${withoutOldStatus.trimEnd()}\n${statusLine}`;
}

function taskPrLabel(event: Pick<CodexSlackEvent, 'prNumber' | 'prUrl'>): string {
  if (!event.prNumber) return 'なし';
  return event.prUrl
    ? `<${event.prUrl}|PR #${event.prNumber}>`
    : `PR #${event.prNumber}`;
}

function reviewerMention(config: CodexSlackRelayConfig, event: CodexSlackEvent, category: CodexSlackCategory): string {
  if (!['error', 'decision'].includes(category)) return '';
  const id = event.operator === 'masato' ? config.SLACK_KENTA_USER_ID : config.SLACK_MASATO_USER_ID;
  return id ? `\n確認：<@${id}>` : '';
}

function buildParentText(config: CodexSlackRelayConfig, event: CodexSlackEvent, category: CodexSlackCategory): string {
  const content = sanitizeSlackContent(singleLine(event.content)).slice(0, 240) || '内容未記入';
  const pr = event.prNumber
    ? event.prUrl
      ? `\nPR：<${event.prUrl}|#${event.prNumber}>`
      : `\nPR：#${event.prNumber}`
    : '';
  const branch = event.branch ? `\nブランチ：\`${event.branch}\`` : '';
  const status = category === 'error'
    ? `\n状態：${errorParentStatusLabel(isCodexTaskCompletion(event) ? 'done' : taskStatusForEvent(event))}`
    : '';
  return `*【${categoryLabel(category)}】${content}*\n担当：${operatorLabel(event.operator)}${pr}${branch}${reviewerMention(config, event, category)}${status}\n\n以降の確認・会話・Codexへの依頼は、このスレッドへ返信してください。`;
}

function buildReplyText(event: CodexSlackEvent, category: CodexSlackCategory): string {
  const eventLabel = event.eventType === 'prompt_submitted'
    ? '作業開始・追加指示'
    : event.eventType === 'approval_required'
      ? '承認・判断待ち'
      : 'Codexからの報告';
  const content = sanitizeSlackContent(event.content) || '内容未記入';
  return `*${operatorLabel(event.operator)}｜${eventLabel}*\n分類：${categoryLabel(category)}\n${content}`;
}

function taskStatusForEvent(event: CodexSlackEvent): Exclude<SlackTaskStatus, 'done'> {
  return event.eventType === 'prompt_submitted' ? 'working' : 'review';
}

function taskEnvironment(event: CodexSlackEvent): 'development' | 'staging' | 'production' {
  if (/(?:本番|production).{0,20}(?:反映|deploy|デプロイ)/i.test(event.content)) return 'production';
  if (/(?:検証|staging).{0,20}(?:反映|deploy|デプロイ)/i.test(event.content)) return 'staging';
  return 'development';
}

function taskActionValue(
  status: SlackTaskStatus,
  key: string,
  sourceChannel: string,
  sourceThreadTs: string,
): string {
  return JSON.stringify({ status, key, sourceChannel, sourceThreadTs });
}

function taskBlocks(
  event: CodexSlackEvent,
  category: CodexSlackCategory,
  status: Exclude<SlackTaskStatus, 'done'>,
  key: string,
  sourceChannel: string,
  sourceThreadTs: string,
  permalink: string,
): Array<Record<string, unknown>> {
  const title = sanitizeSlackContent(singleLine(event.content)).slice(0, 240) || '内容未記入';
  const taskId = taskIdForKey(key);
  const pr = taskPrLabel(event);
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*【要対応｜${categoryLabel(category)}】*\n${title}` },
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `*TASK-ID:* \`${taskId}\`　新しいCodexチャットでは \`${taskId} この対応を進めて\` と入力`,
      }],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*状態*\n${taskStatusLabel(status)}` },
        { type: 'mrkdwn', text: `*担当*\n${operatorLabel(event.operator)}` },
        { type: 'mrkdwn', text: `*関連*\n${pr}` },
        { type: 'mrkdwn', text: `*元スレッド*\n<${permalink}|確認する>` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '作業中' },
          action_id: `${TASK_ACTION_ID}_working`,
          value: taskActionValue('working', key, sourceChannel, sourceThreadTs),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '確認待ち' },
          action_id: `${TASK_ACTION_ID}_review`,
          value: taskActionValue('review', key, sourceChannel, sourceThreadTs),
        },
        {
          type: 'button',
          style: 'primary',
          text: { type: 'plain_text', text: '完了' },
          action_id: `${TASK_ACTION_ID}_done`,
          value: taskActionValue('done', key, sourceChannel, sourceThreadTs),
          confirm: {
            title: { type: 'plain_text', text: 'タスクを完了しますか？' },
            text: { type: 'mrkdwn', text: '要対応一覧から消え、元スレッドに完了履歴が残ります。' },
            confirm: { type: 'plain_text', text: '完了する' },
            deny: { type: 'plain_text', text: '戻る' },
          },
        },
      ],
    },
  ];
}

function taskText(
  event: CodexSlackEvent,
  category: CodexSlackCategory,
  status: Exclude<SlackTaskStatus, 'done'>,
  key: string,
): string {
  const title = sanitizeSlackContent(singleLine(event.content)).slice(0, 240) || '内容未記入';
  return `【要対応｜${categoryLabel(category)}】${title}\nTASK-ID：${taskIdForKey(key)}\n状態：${taskStatusLabel(status)}\n担当：${operatorLabel(event.operator)}`;
}

async function slackApi(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<SlackApiResponse> {
  const response = await fetcher(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });
  const result: SlackApiResponse = await response.json<SlackApiResponse>().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(`SLACK_API_FAILED:${method}:${response.status}:${result.error || 'unknown'}`);
  }
  return result;
}

async function updateErrorParentStatus(
  config: CodexSlackRelayConfig,
  channel: string,
  threadTs: string,
  status: SlackTaskStatus,
  fetcher: typeof fetch,
): Promise<void> {
  const token = config.SLACK_BOT_TOKEN;
  if (!token || channel !== config.SLACK_ERROR_CHANNEL_ID) return;
  try {
    const replies = await slackApi(token, 'conversations.replies', {
      channel,
      ts: threadTs,
      limit: 1,
      include_all_metadata: true,
    }, fetcher);
    const parent = replies.messages?.find((message) => message.ts === threadTs) || replies.messages?.[0];
    if (
      !parent?.ts ||
      parent.metadata?.event_type !== THREAD_METADATA_TYPE ||
      parent.metadata.event_payload?.category !== 'error'
    ) return;
    await slackApi(token, 'chat.update', {
      channel,
      ts: parent.ts,
      text: replaceErrorParentStatusText(parent.text || '【:warning: エラー報告】', status),
      metadata: parent.metadata,
    }, fetcher);
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'slack_error_parent_status_update_failed',
      channel,
      threadTs,
      status,
      error: String(error),
    }));
  }
}

async function findThreadTs(
  token: string,
  channel: string,
  key: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  let cursor = '';
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await slackApi(token, 'conversations.history', {
      channel,
      limit: 100,
      include_all_metadata: true,
      ...(cursor ? { cursor } : {}),
    }, fetcher);
    const match = result.messages?.find((message) => (
      message.metadata?.event_type === THREAD_METADATA_TYPE &&
      message.metadata.event_payload?.work_key === key
    ));
    if (match?.ts) return match.ts;
    cursor = result.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return null;
}

async function findTaskMessage(
  token: string,
  channel: string,
  selector: { key?: string; taskId?: string; sessionId?: string },
  fetcher: typeof fetch,
): Promise<SlackMessage | null> {
  let cursor = '';
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await slackApi(token, 'conversations.history', {
      channel,
      limit: 100,
      include_all_metadata: true,
      ...(cursor ? { cursor } : {}),
    }, fetcher);
    const match = result.messages?.find((message) => {
      if (message.metadata?.event_type !== TASK_METADATA_TYPE) return false;
      const metadata = message.metadata.event_payload;
      return (selector.key && metadata?.work_key === selector.key) ||
        (selector.taskId && metadata?.task_id === selector.taskId) ||
        (selector.sessionId && metadata?.session_id === selector.sessionId);
    });
    if (match?.ts) return match;
    cursor = result.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return null;
}

async function listTaskMessages(
  token: string,
  channel: string,
  fetcher: typeof fetch,
): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await slackApi(token, 'conversations.history', {
      channel,
      limit: 100,
      include_all_metadata: true,
      ...(cursor ? { cursor } : {}),
    }, fetcher);
    messages.push(...(result.messages || []).filter((message) => message.metadata?.event_type === TASK_METADATA_TYPE));
    cursor = result.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return messages;
}

async function findCommandCenterMessage(
  token: string,
  channel: string,
  fetcher: typeof fetch,
): Promise<SlackMessage | null> {
  let cursor = '';
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await slackApi(token, 'conversations.history', {
      channel,
      limit: 100,
      include_all_metadata: true,
      ...(cursor ? { cursor } : {}),
    }, fetcher);
    const match = result.messages?.find((message) => message.metadata?.event_type === COMMAND_CENTER_METADATA_TYPE);
    if (match?.ts) return match;
    cursor = result.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return null;
}

export type SlackCommandCenterTask = {
  taskId: string;
  status: Exclude<SlackTaskStatus, 'done'>;
  operator: string;
  title: string;
  prNumber?: number;
  sourceChannel?: string;
  sourceThreadTs?: string;
  workKey?: string;
  environment: 'development' | 'staging' | 'production';
};

function commandCenterTask(message: SlackMessage): SlackCommandCenterTask | null {
  const metadata = message.metadata?.event_payload;
  if (!metadata) return null;
  const status = /確認待ち/.test(message.text || '')
    ? 'review'
    : /作業中/.test(message.text || '')
      ? 'working'
      : metadata.status === 'review'
        ? 'review'
        : 'working';
  const prNumber = /^\d+$/.test(metadata.pr_number || '') ? Number(metadata.pr_number) : undefined;
  const operator = metadata.operator === 'kenta'
    ? 'ケンタ'
    : metadata.operator === 'masato'
      ? 'マサト'
      : metadata.operator === 'codex'
        ? 'Codex'
        : message.text?.match(/担当：([^\n]+)/)?.[1]?.replace(/:[a-z_]+:/g, '').trim() || '未設定';
  const environment = ['development', 'staging', 'production'].includes(metadata.environment || '')
    ? metadata.environment as SlackCommandCenterTask['environment']
    : 'development';
  return {
    taskId: metadata.task_id || taskIdForKey(metadata.work_key || message.ts || 'unknown'),
    status,
    operator,
    title: singleLine(metadata.title || message.text || '内容未記入').slice(0, 120),
    prNumber,
    sourceChannel: metadata.source_channel,
    sourceThreadTs: metadata.source_thread_ts,
    workKey: metadata.work_key,
    environment,
  };
}

function prOwner(pr: CodexSlackPrSnapshot): string {
  if (/(?:^|\/)masato(?:-|\/|$)/i.test(pr.headRefName)) return 'マサト';
  if (/(?:^|\/)kenta(?:-|\/|$)/i.test(pr.headRefName)) return 'ケンタ';
  return pr.author || '未設定';
}

function checkLabel(checks: CodexSlackPrSnapshot['checks']): string {
  if (checks === 'pass') return 'チェック✅';
  if (checks === 'pending') return 'チェック⏳';
  if (checks === 'fail') return 'チェック❌';
  return 'チェックなし';
}

function prStateLabel(pr: CodexSlackPrSnapshot): string {
  if (pr.isDraft) return 'Draft';
  if (pr.mergeStateStatus === 'CLEAN') return '統合可能';
  if (pr.mergeStateStatus === 'DIRTY') return '競合あり';
  if (pr.mergeStateStatus === 'BLOCKED') return '停止中';
  if (pr.mergeStateStatus === 'BEHIND') return '開発版より遅れ';
  return '状態確認中';
}

function prOrderDecision(pr: CodexSlackPrSnapshot, older: CodexSlackPrSnapshot[]): string {
  const overlapping = older.filter((candidate) => pr.overlapsWith.includes(candidate.number));
  if (overlapping.length > 0) return `追い越し不可（#${overlapping.map((item) => item.number).join('・#')}と変更重複）`;
  const activeOlder = older.find((candidate) => !candidate.isDraft);
  if (activeOlder) return `追い越し不可（#${activeOlder.number}を先に確認）`;
  if (pr.isDraft) return '保留中。後続PRは変更重複がなければ追い越し候補';
  if (pr.checks === 'fail') return '停止中（チェック失敗）';
  if (pr.checks === 'pending') return 'チェック完了待ち';
  if (pr.mergeStateStatus === 'DIRTY' || pr.mergeStateStatus === 'BLOCKED') return '停止中（競合・必須条件を確認）';
  return older.length > 0 ? '追い越し候補（古いPRはDraft、変更重複なし）' : '次に統合する候補';
}

function previousPrSection(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(/\*PR順・追い越し判断\*\n([\s\S]*?)\n\*作業・停止・反映状況\*/);
  return match?.[1]?.trim() || null;
}

function taskDuplicateLines(tasks: SlackCommandCenterTask[]): string[] {
  const groups = new Map<string, SlackCommandCenterTask[]>();
  for (const task of tasks) {
    const keys = [
      task.prNumber ? `PR #${task.prNumber}` : '',
      task.sourceChannel && task.sourceThreadTs ? `元スレッド ${task.sourceChannel}:${task.sourceThreadTs}` : '',
      task.workKey ? `作業キー ${task.workKey}` : '',
    ].filter(Boolean);
    for (const key of keys) groups.set(key, [...(groups.get(key) || []), task]);
  }
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const [key, values] of groups) {
    const ids = [...new Set(values.map((item) => item.taskId))];
    if (ids.length < 2) continue;
    const signature = ids.sort().join(':');
    if (seen.has(signature)) continue;
    seen.add(signature);
    duplicates.push(`- ⚠️ ${key} が ${ids.length}件（${ids.join(' / ')}）`);
  }
  return duplicates;
}

function taskStopReason(task: SlackCommandCenterTask): string {
  if (task.status === 'review') return '確認待ち';
  const match = task.title.match(/(競合|承認待ち|判断待ち|ロック|失敗|停止|blocked)/i)?.[1];
  return match ? `${match}を確認` : 'なし';
}

function taskEnvironmentLabel(task: SlackCommandCenterTask): string {
  if (task.environment === 'production') return '開発✅ 検証✅ 本番確認中';
  if (task.environment === 'staging') return '開発✅ 検証確認中 本番—（本番未反映）';
  return '開発中 検証— 本番—（本番未反映）';
}

function formattedJst(occurredAt: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(occurredAt));
}

export function buildSlackCommandCenterText(
  openPrs: CodexSlackPrSnapshot[] | undefined,
  tasks: SlackCommandCenterTask[],
  occurredAt: string,
  previousText?: string,
): string {
  const prs = [...(openPrs || [])].sort((a, b) => a.number - b.number).slice(0, 20);
  const duplicateLines = taskDuplicateLines(tasks);
  const reviewCount = tasks.filter((task) => task.status === 'review').length;
  let prLines: string[];
  if (openPrs) {
    const firstActive = prs.find((pr) => !pr.isDraft);
    const creationRule = firstActive
      ? `新規PR作成：可。統合順は原則 #${firstActive.number} が先（重複と停止理由で再判定）`
      : prs.length > 0
        ? `新規PR作成：可。既存${prs.map((pr) => `#${pr.number}`).join('・')}はDraftのため、変更重複がなければ先に統合可能`
        : '新規PR作成：可。未完了PRはありません';
    prLines = [creationRule, ...prs.flatMap((pr, index) => [
      `${index + 1}. <${pr.url}|#${pr.number}> ${prOwner(pr)}｜${prStateLabel(pr)}｜${checkLabel(pr.checks)}｜変更${pr.fileCount}件｜${sanitizeSlackContent(singleLine(pr.title)).slice(0, 80)}`,
      `   ${prOrderDecision(pr, prs.slice(0, index))}｜開発PR・検証—・本番—`,
    ])];
  } else {
    prLines = (previousPrSection(previousText) || 'GitHub情報は次のCodex報告で同期します').split('\n');
  }
  const taskLines = tasks.length === 0
    ? ['- 未完了タスクなし']
    : tasks.slice(0, 15).flatMap((task) => {
      const source = task.sourceChannel && task.sourceThreadTs
        ? `｜<https://slack.com/archives/${task.sourceChannel}/p${task.sourceThreadTs.replace('.', '')}|元スレッド>`
        : '';
      const related = task.prNumber ? `｜PR #${task.prNumber}` : '';
      return [
        `- ${task.taskId}｜${task.operator}｜${task.status === 'working' ? '作業中' : '確認待ち'}${related}${source}`,
        `  ${taskEnvironmentLabel(task)}｜停止理由：${taskStopReason(task)}｜${task.title}`,
      ];
    });
  return [
    '*【LINE Harness 開発指令盤】*',
    `更新：${formattedJst(occurredAt)} JST｜作業中 ${tasks.length - reviewCount}｜確認待ち ${reviewCount}｜未完了PR ${openPrs ? prs.length : '前回同期'}｜重複候補 ${duplicateLines.length}`,
    '',
    '*PR順・追い越し判断*',
    ...prLines,
    '',
    '*作業・停止・反映状況*',
    ...taskLines,
    '',
    '*重複*',
    ...(duplicateLines.length > 0 ? duplicateLines : ['- なし']),
    '',
    '_PR番号は作成順です。先に上げてよいかは「変更重複・Draft・チェック・競合」で判定します。正本はGitHubです。_',
  ].join('\n').slice(0, 3_900);
}

async function refreshSlackCommandCenter(
  config: CodexSlackRelayConfig,
  openPrs: CodexSlackPrSnapshot[] | undefined,
  occurredAt: string,
  fetcher: typeof fetch,
): Promise<void> {
  const token = config.SLACK_BOT_TOKEN;
  const commandChannel = config.SLACK_COMMAND_CHANNEL_ID;
  const taskChannel = config.SLACK_TASK_CHANNEL_ID;
  if (!token || !commandChannel || !taskChannel) return;
  try {
    const [messages, existing] = await Promise.all([
      listTaskMessages(token, taskChannel, fetcher),
      findCommandCenterMessage(token, commandChannel, fetcher),
    ]);
    const tasks = messages.map(commandCenterTask).filter((task): task is SlackCommandCenterTask => Boolean(task));
    const text = buildSlackCommandCenterText(openPrs, tasks, occurredAt, existing?.text);
    if (existing?.ts) {
      await slackApi(token, 'chat.update', { channel: commandChannel, ts: existing.ts, text }, fetcher);
    } else {
      await slackApi(token, 'chat.postMessage', {
        channel: commandChannel,
        text,
        metadata: { event_type: COMMAND_CENTER_METADATA_TYPE, event_payload: { version: '1' } },
        client_msg_id: `command-center:${Date.now()}`,
      }, fetcher);
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: 'slack_command_center_refresh_failed', error: String(error) }));
  }
}

function replaceTaskStatusText(text: string, status: Exclude<SlackTaskStatus, 'done'>): string {
  const next = `状態：${taskStatusLabel(status)}`;
  return /状態：[^\n]*/.test(text) ? text.replace(/状態：[^\n]*/, next) : `${text}\n${next}`;
}

function replaceTaskStatusBlocks(
  blocks: Array<Record<string, unknown>> | undefined,
  status: Exclude<SlackTaskStatus, 'done'>,
  event?: CodexSlackEvent,
): Array<Record<string, unknown>> | undefined {
  if (!blocks) return undefined;
  return blocks.map((block) => {
    if (block.type !== 'section' || !Array.isArray(block.fields)) return block;
    return {
      ...block,
      fields: block.fields.map((field) => {
        if (!field || typeof field !== 'object') return field;
        const current = field as Record<string, unknown>;
        if (typeof current.text !== 'string') return field;
        if (current.text.startsWith('*状態*')) {
          return { ...current, text: `*状態*\n${taskStatusLabel(status)}` };
        }
        if (event?.prNumber && current.text.startsWith('*関連*')) {
          return { ...current, text: `*関連*\n${taskPrLabel(event)}` };
        }
        return field;
      }),
    };
  });
}

function taskMetadataForEvent(
  message: SlackMessage,
  event: CodexSlackEvent | undefined,
  status: Exclude<SlackTaskStatus, 'done'>,
): SlackMessage['metadata'] | undefined {
  if (message.metadata?.event_type !== TASK_METADATA_TYPE) return undefined;
  const current = message.metadata.event_payload || {};
  return {
    event_type: TASK_METADATA_TYPE,
    event_payload: {
      ...current,
      status,
      ...(event ? {
        session_id: event.sessionId,
        operator: event.operator,
        title: sanitizeSlackContent(singleLine(event.content)).slice(0, 240),
        environment: taskEnvironment(event),
      } : {}),
      ...(event?.prNumber ? { pr_number: String(event.prNumber) } : {}),
      ...(event?.prUrl ? { pr_url: event.prUrl } : {}),
    },
  };
}

async function updateTaskMessageStatus(
  token: string,
  channel: string,
  message: SlackMessage,
  status: Exclude<SlackTaskStatus, 'done'>,
  fetcher: typeof fetch,
  event?: CodexSlackEvent,
): Promise<void> {
  if (!message.ts) return;
  const blocks = replaceTaskStatusBlocks(message.blocks, status, event);
  const metadata = taskMetadataForEvent(message, event, status);
  await slackApi(token, 'chat.update', {
    channel,
    ts: message.ts,
    text: replaceTaskStatusText(message.text || '【要対応】', status),
    ...(blocks ? { blocks } : {}),
    ...(metadata ? { metadata } : {}),
  }, fetcher);
}

async function ensureOpenTask(
  config: CodexSlackRelayConfig,
  event: CodexSlackEvent,
  category: CodexSlackCategory,
  key: string,
  sourceChannel: string,
  sourceThreadTs: string,
  fetcher: typeof fetch,
): Promise<void> {
  const token = config.SLACK_BOT_TOKEN;
  const taskChannel = config.SLACK_TASK_CHANNEL_ID;
  if (!token || !taskChannel || !shouldTrackCodexTask(event, category)) return;
  const status = taskStatusForEvent(event);
  const existing = await findTaskMessage(token, taskChannel, { key }, fetcher);
  if (existing) {
    await updateTaskMessageStatus(token, taskChannel, existing, status, fetcher, event);
    return;
  }
  let permalink = `https://slack.com/archives/${sourceChannel}/p${sourceThreadTs.replace('.', '')}`;
  try {
    const permalinkResult = await slackApi(token, 'chat.getPermalink', {
      channel: sourceChannel,
      message_ts: sourceThreadTs,
    }, fetcher);
    permalink = permalinkResult.permalink || permalink;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'slack_permalink_fallback',
      sourceChannel,
      sourceThreadTs,
      error: String(error),
    }));
  }
  await slackApi(token, 'chat.postMessage', {
    channel: taskChannel,
    text: taskText(event, category, status, key),
    blocks: taskBlocks(event, category, status, key, sourceChannel, sourceThreadTs, permalink),
    metadata: {
      event_type: TASK_METADATA_TYPE,
      event_payload: {
        work_key: key,
        task_id: taskIdForKey(key),
        source_channel: sourceChannel,
        source_thread_ts: sourceThreadTs,
        session_id: event.sessionId,
        status,
        operator: event.operator,
        title: sanitizeSlackContent(singleLine(event.content)).slice(0, 240),
        environment: taskEnvironment(event),
        ...(event.prNumber ? { pr_number: String(event.prNumber) } : {}),
        ...(event.prUrl ? { pr_url: event.prUrl } : {}),
      },
    },
    client_msg_id: `${event.eventId}:task`,
  }, fetcher);
}

async function closeOpenTask(
  config: CodexSlackRelayConfig,
  key: string,
  fetcher: typeof fetch,
): Promise<void> {
  const token = config.SLACK_BOT_TOKEN;
  const taskChannel = config.SLACK_TASK_CHANNEL_ID;
  if (!token || !taskChannel) return;
  const existing = await findTaskMessage(token, taskChannel, { key }, fetcher);
  if (!existing?.ts) return;
  await slackApi(token, 'chat.delete', { channel: taskChannel, ts: existing.ts }, fetcher);
}

type SlackTaskActionPayload = {
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; text?: string; blocks?: Array<Record<string, unknown>> };
  actions?: Array<{ action_id?: string; value?: string }>;
};

function parseTaskActionValue(value: string | undefined): {
  status: SlackTaskStatus;
  key: string;
  sourceChannel: string;
  sourceThreadTs: string;
} | null {
  if (!value || value.length > 2_000) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      !['working', 'review', 'done'].includes(String(parsed.status)) ||
      typeof parsed.key !== 'string' || parsed.key.length < 3 || parsed.key.length > 500 ||
      typeof parsed.sourceChannel !== 'string' || !/^[CG][A-Z0-9]+$/.test(parsed.sourceChannel) ||
      typeof parsed.sourceThreadTs !== 'string' || !/^\d{10,}\.\d{6}$/.test(parsed.sourceThreadTs)
    ) return null;
    return {
      status: parsed.status as SlackTaskStatus,
      key: parsed.key,
      sourceChannel: parsed.sourceChannel,
      sourceThreadTs: parsed.sourceThreadTs,
    };
  } catch {
    return null;
  }
}

export async function handleSlackTaskAction(
  config: CodexSlackRelayConfig,
  payload: SlackTaskActionPayload,
  fetcher: typeof fetch = fetch,
): Promise<{ status: SlackTaskStatus }> {
  const token = config.SLACK_BOT_TOKEN;
  const taskChannel = config.SLACK_TASK_CHANNEL_ID;
  if (!token || !taskChannel) throw new Error('SLACK_TASK_BOARD_NOT_CONFIGURED');
  const userId = payload.user?.id;
  const allowedUsers = [config.SLACK_KENTA_USER_ID, config.SLACK_MASATO_USER_ID].filter(Boolean);
  if (!userId || !allowedUsers.includes(userId)) throw new Error('SLACK_TASK_ACTION_FORBIDDEN');
  if (payload.channel?.id !== taskChannel || !payload.message?.ts) {
    throw new Error('SLACK_TASK_ACTION_INVALID_CHANNEL');
  }
  const action = payload.actions?.find((item) => (
    item.action_id === TASK_ACTION_ID || item.action_id?.startsWith(`${TASK_ACTION_ID}_`)
  ));
  const value = parseTaskActionValue(action?.value);
  if (!value) throw new Error('SLACK_TASK_ACTION_INVALID_VALUE');

  if (value.status === 'done') {
    await updateErrorParentStatus(
      config,
      value.sourceChannel,
      value.sourceThreadTs,
      'done',
      fetcher,
    );
    await slackApi(token, 'chat.postMessage', {
      channel: value.sourceChannel,
      thread_ts: value.sourceThreadTs,
      text: `:white_check_mark: <@${userId}> が要対応タスクを完了にしました。`,
    }, fetcher);
    await slackApi(token, 'chat.delete', {
      channel: taskChannel,
      ts: payload.message.ts,
    }, fetcher);
    await refreshSlackCommandCenter(config, undefined, new Date().toISOString(), fetcher);
    return { status: 'done' };
  }

  await updateTaskMessageStatus(token, taskChannel, payload.message, value.status, fetcher);
  await updateErrorParentStatus(
    config,
    value.sourceChannel,
    value.sourceThreadTs,
    value.status,
    fetcher,
  );
  await refreshSlackCommandCenter(config, undefined, new Date().toISOString(), fetcher);
  return { status: value.status };
}

export type HarnessErrorReport = {
  source: 'worker' | 'admin';
  message: string;
  path?: string;
  stack?: string;
  occurredAt?: string;
};

function normalizedHarnessErrorPath(value: string | undefined): string {
  const raw = singleLine(value || 'unknown');
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.replace(/[?#].*$/, '');
  }
}

export function harnessErrorIncidentKey(report: HarnessErrorReport): string {
  const path = normalizedHarnessErrorPath(report.path);
  const httpStatus = report.message.match(/(?:api|http)(?:\s+error)?\s*:?\s*([45]\d{2})/i)?.[1];
  if (httpStatus) return `${report.source}:${path}:http:${httpStatus}`;
  return `${report.source}:${path}:${singleLine(report.message).toLowerCase()}`;
}

export async function reportHarnessErrorToSlack(
  config: CodexSlackRelayConfig,
  report: HarnessErrorReport,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!config.SLACK_BOT_TOKEN || !config.SLACK_ERROR_CHANNEL_ID) return false;
  const message = sanitizeSlackContent(singleLine(report.message)).slice(0, 500) || '不明なエラー';
  const path = sanitizeSlackContent(singleLine(report.path || '')).slice(0, 300);
  const stack = sanitizeSlackContent(report.stack || '').split('\n').slice(0, 8).join('\n').slice(0, 1_200);
  const fingerprint = taskIdForKey(harnessErrorIncidentKey(report)).slice(5);
  const runtimeSessionId = `runtime-${fingerprint}`;
  const taskId = taskIdForKey(`session:${runtimeSessionId}`);
  const content = [
    `LINE Harnessがエラーを自動検知しました。`,
    `発生元：${report.source === 'worker' ? 'Worker' : '管理画面'}`,
    path ? `場所：${path}` : '',
    `内容：${message}`,
    stack ? `スタック：\n${stack}` : '',
    `エラーID：ERR-${fingerprint}`,
    `TASK-ID：${taskId}`,
  ].filter(Boolean).join('\n');
  await relayCodexSlackEvent(config, {
    version: 1,
    eventId: `runtime:${fingerprint}:${Date.now()}`,
    eventType: 'approval_required',
    sessionId: runtimeSessionId,
    operator: 'codex',
    content,
    occurredAt: report.occurredAt || new Date().toISOString(),
    explicitCategory: 'error',
  }, fetcher);
  return true;
}

export async function relayCodexSlackEvent(
  config: CodexSlackRelayConfig,
  event: CodexSlackEvent,
  fetcher: typeof fetch = fetch,
): Promise<{ category: CodexSlackCategory; channelId: string; threadTs: string }> {
  const token = config.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN_NOT_CONFIGURED');
  const category = classifyCodexSlackEvent(event);
  let channelId = resolveCodexSlackChannel(config, category, event.prNumber);
  if (!channelId) throw new Error(`SLACK_CHANNEL_NOT_CONFIGURED:${category}`);
  let key = workKey(event);
  let threadTs: string | null = null;
  let createdParent = false;
  let linkedTask: SlackMessage | null = null;

  const requestedTaskId = taskIdFromContent(event.content);
  if (
    (requestedTaskId || event.eventType === 'turn_completed' || event.syncMode === 'reconcile') &&
    config.SLACK_TASK_CHANNEL_ID
  ) {
    linkedTask = await findTaskMessage(
      token,
      config.SLACK_TASK_CHANNEL_ID,
      requestedTaskId
        ? { taskId: requestedTaskId }
        : { sessionId: event.sessionId, key },
      fetcher,
    );
    const metadata = linkedTask?.metadata?.event_payload;
    if (
      metadata?.work_key &&
      metadata.source_channel && /^[CG][A-Z0-9]+$/.test(metadata.source_channel) &&
      metadata.source_thread_ts && /^\d{10,}\.\d{6}$/.test(metadata.source_thread_ts)
    ) {
      key = metadata.work_key;
      channelId = metadata.source_channel;
      threadTs = metadata.source_thread_ts;
    }
  }

  threadTs ||= await findThreadTs(token, channelId, key, fetcher);
  const completed = isCodexTaskCompletion(event);

  // GitHub's periodic reconciliation must repair missing notifications without
  // adding a new reply every time the workflow runs. Slack metadata is the
  // ledger: an existing PR thread means the parent notification arrived, and
  // an existing task card means the PR is still open.
  if (event.syncMode === 'reconcile' && threadTs) {
    if (completed && linkedTask) {
      await slackApi(token, 'chat.postMessage', {
        channel: channelId,
        thread_ts: threadTs,
        text: buildReplyText(event, category),
        client_msg_id: event.eventId,
      }, fetcher);
      await closeOpenTask(config, key, fetcher);
    } else if (!completed && !linkedTask) {
      await ensureOpenTask(config, event, category, key, channelId, threadTs, fetcher);
    }
    if (event.refreshCommandCenter !== false) {
      await refreshSlackCommandCenter(config, event.openPrs, event.occurredAt, fetcher);
    }
    return { category, channelId, threadTs };
  }

  if (!threadTs) {
    const parent = await slackApi(token, 'chat.postMessage', {
      channel: channelId,
      text: buildParentText(config, event, category),
      metadata: {
        event_type: THREAD_METADATA_TYPE,
        event_payload: { work_key: key, category },
      },
      client_msg_id: `${event.eventId}:parent`,
    }, fetcher);
    if (!parent.ts) throw new Error('SLACK_PARENT_TS_MISSING');
    threadTs = parent.ts;
    createdParent = true;
  }

  await slackApi(token, 'chat.postMessage', {
    channel: channelId,
    thread_ts: threadTs,
    text: buildReplyText(event, category),
    client_msg_id: event.eventId,
  }, fetcher);

  if (!createdParent) {
    await updateErrorParentStatus(
      config,
      channelId,
      threadTs,
      completed ? 'done' : taskStatusForEvent(event),
      fetcher,
    );
  }

  if (completed) {
    await closeOpenTask(config, key, fetcher);
  } else {
    await ensureOpenTask(config, event, category, key, channelId, threadTs, fetcher);
  }

  if (event.refreshCommandCenter !== false) {
    await refreshSlackCommandCenter(config, event.openPrs, event.occurredAt, fetcher);
  }

  return { category, channelId, threadTs };
}
