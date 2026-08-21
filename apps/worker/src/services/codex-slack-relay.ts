export type CodexSlackCategory = 'error' | 'idea' | 'fix' | 'decision';

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
};

type SlackMessage = {
  ts?: string;
  metadata?: {
    event_type?: string;
    event_payload?: Record<string, string>;
  };
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  ts?: string;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

const THREAD_METADATA_TYPE = 'line_harness_codex';
const MAX_HISTORY_PAGES = 5;
const MAX_SLACK_CONTENT_LENGTH = 2_500;

const ERROR_PATTERN = /(エラー|白(?:い)?画面|例外|失敗|動かない|できない|不具合|クラッシュ|競合|conflict|error|exception|failed|failure|crash)/i;
const IDEA_PATTERN = /(アイデア|改善案|提案|思いつ|将来案|検討案|こうしたい|正本化|idea|proposal|suggestion)/i;
const FIX_PATTERN = /(修正|直して|対応|実装|変更|作って|追加|更新|レビュー|PR\s*#?\d+|fix|implement|update|review)/i;

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
  if (ERROR_PATTERN.test(event.content)) return 'error';
  if (IDEA_PATTERN.test(event.content)) return 'idea';
  if (event.prNumber || FIX_PATTERN.test(event.content)) return 'fix';
  return 'decision';
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

function workKey(event: CodexSlackEvent, category: CodexSlackCategory): string {
  if (category === 'fix' && event.prNumber) return `pr:${event.prNumber}`;
  if (category === 'fix' && event.branch && !['main', 'master', 'codex/development'].includes(event.branch)) {
    return `branch:${event.repository || 'repo'}:${event.branch}`;
  }
  return `${category}:session:${event.sessionId}`;
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
  return `*【${categoryLabel(category)}】${content}*\n担当：${operatorLabel(event.operator)}${pr}${branch}${reviewerMention(config, event, category)}\n\n以降の確認・会話・Codexへの依頼は、このスレッドへ返信してください。`;
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

export async function relayCodexSlackEvent(
  config: CodexSlackRelayConfig,
  event: CodexSlackEvent,
  fetcher: typeof fetch = fetch,
): Promise<{ category: CodexSlackCategory; channelId: string; threadTs: string }> {
  const token = config.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN_NOT_CONFIGURED');
  const category = classifyCodexSlackEvent(event);
  const channelId = resolveCodexSlackChannel(config, category, event.prNumber);
  if (!channelId) throw new Error(`SLACK_CHANNEL_NOT_CONFIGURED:${category}`);
  const key = workKey(event, category);

  let threadTs = await findThreadTs(token, channelId, key, fetcher);
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
  }

  await slackApi(token, 'chat.postMessage', {
    channel: channelId,
    thread_ts: threadTs,
    text: buildReplyText(event, category),
    client_msg_id: event.eventId,
  }, fetcher);

  return { category, channelId, threadTs };
}
