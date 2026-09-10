export type AiLoopReportStatus = 'started' | 'completed' | 'failed' | 'approval';

export type AiLoopReport = {
  version: 1;
  eventId: string;
  taskId: string;
  repository: string;
  title: string;
  commander: 'codex' | 'claude';
  executor: 'meta' | 'codex';
  model: string;
  status: AiLoopReportStatus;
  summary: string;
  taskUrl: string;
  prUrl?: string;
  occurredAt: string;
  revision: number;
};

export type AiLoopSlackConfig = {
  DB: D1Database;
  SLACK_BOT_TOKEN?: string;
  SLACK_AI_LOOP_CHANNEL_ID?: string;
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

const METADATA_TYPE = 'nen_ai_loop_report';
const RECOVERY_HISTORY_PAGES = 5;
const CLAIM_TTL_MS = 2 * 60 * 1000;

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
    throw new Error(`SLACK_API_FAILED:${method}:${result.error || response.status}`);
  }
  return result;
}

function oneLine(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function reportKey(report: AiLoopReport): string {
  return `ai-loop:${report.repository}:${report.taskId}`;
}

async function stableClientMessageId(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function reportText(report: AiLoopReport): string {
  const status = {
    started: '🟦 開始',
    completed: '✅ 完了',
    failed: '❌ 失敗',
    approval: '🟨 人間確認が必要',
  }[report.status];
  return [
    `【AI開発】${oneLine(report.title, 120)}`,
    `状態：${status}`,
    `司令塔：${report.commander === 'codex' ? 'Codex' : 'Claude'}`,
    `実装：${report.executor === 'meta' ? 'Meta Muse' : 'Codex'}（${oneLine(report.model, 80)}）`,
    `概要：${oneLine(report.summary, 500)}`,
    `タスク：${report.taskUrl}`,
    ...(report.prUrl ? [`PR：${report.prUrl}`] : []),
  ].join('\n');
}

async function findExisting(
  token: string,
  channel: string,
  key: string,
  fetcher: typeof fetch,
): Promise<SlackMessage | null> {
  let cursor = '';
  for (let page = 0; page < RECOVERY_HISTORY_PAGES; page += 1) {
    const result = await slackApi(token, 'conversations.history', {
      channel,
      limit: 100,
      include_all_metadata: true,
      ...(cursor ? { cursor } : {}),
    }, fetcher);
    const found = result.messages?.find((message) => (
      message.metadata?.event_type === METADATA_TYPE &&
      message.metadata.event_payload?.work_key === key
    ));
    if (found?.ts) return found;
    cursor = result.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return null;
}

export async function relayAiLoopReport(
  config: AiLoopSlackConfig,
  report: AiLoopReport,
  fetcher: typeof fetch = fetch,
): Promise<{ action: 'created' | 'updated' | 'ignored'; ts?: string }> {
  const token = config.SLACK_BOT_TOKEN;
  const channel = config.SLACK_AI_LOOP_CHANNEL_ID;
  if (!token || !channel) throw new Error('AI_LOOP_SLACK_REPORT_NOT_CONFIGURED');

  const key = reportKey(report);
  const now = Date.now();
  const previous = await config.DB.prepare(
    `SELECT slack_ts, revision, claim_token, claim_expires_at
       FROM ai_loop_slack_reports WHERE work_key = ?`,
  ).bind(key).first<{ slack_ts: string | null; revision: number; claim_token: string | null; claim_expires_at: number | null }>();
  const claimToken = crypto.randomUUID();
  const claimed = await config.DB.prepare(
    `INSERT INTO ai_loop_slack_reports
       (work_key, slack_ts, revision, claim_token, claim_expires_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, ?)
     ON CONFLICT(work_key) DO UPDATE SET
       revision = excluded.revision,
       claim_token = excluded.claim_token,
       claim_expires_at = excluded.claim_expires_at,
       updated_at = excluded.updated_at
     WHERE (ai_loop_slack_reports.claim_token IS NULL AND ai_loop_slack_reports.revision < excluded.revision)
        OR (ai_loop_slack_reports.claim_token IS NOT NULL
            AND ai_loop_slack_reports.claim_expires_at <= ?
            AND ai_loop_slack_reports.revision <= excluded.revision)`,
  ).bind(key, report.revision, claimToken, now + CLAIM_TTL_MS, now, now).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    const current = await config.DB.prepare(
      'SELECT slack_ts, revision FROM ai_loop_slack_reports WHERE work_key = ?',
    ).bind(key).first<{ slack_ts: string | null; revision: number }>();
    if (current && current.revision < report.revision) {
      throw new Error('AI_LOOP_SLACK_REPORT_BUSY');
    }
    return { action: 'ignored', ...(current?.slack_ts ? { ts: current.slack_ts } : {}) };
  }

  let slackTs = previous?.slack_ts || null;
  // A worker may stop after Slack accepted a create but before D1 recorded its ts.
  // Only that expired-claim recovery path scans recent history; normal updates use D1.
  if (!slackTs && previous?.claim_token && Number(previous.claim_expires_at ?? 0) <= now) {
    slackTs = (await findExisting(token, channel, key, fetcher))?.ts || null;
  }

  const payload = {
    channel,
    text: reportText(report),
    metadata: {
      event_type: METADATA_TYPE,
      event_payload: {
        work_key: key,
        event_id: report.eventId,
        task_id: report.taskId,
        repository: report.repository,
        status: report.status,
        commander: report.commander,
        executor: report.executor,
        model: report.model,
        revision: String(report.revision),
        occurred_at: report.occurredAt,
      },
    },
  };

  if (slackTs) {
    await slackApi(token, 'chat.update', { ...payload, ts: slackTs }, fetcher);
  } else {
    const created = await slackApi(token, 'chat.postMessage', {
      ...payload,
      client_msg_id: await stableClientMessageId(key),
    }, fetcher);
    if (!created.ts) throw new Error('SLACK_API_FAILED:chat.postMessage:missing_ts');
    slackTs = created.ts;
  }
  const finalized = await config.DB.prepare(
    `UPDATE ai_loop_slack_reports
        SET slack_ts = ?, claim_token = NULL, claim_expires_at = NULL, updated_at = ?
      WHERE work_key = ? AND revision = ? AND claim_token = ?`,
  ).bind(slackTs, Date.now(), key, report.revision, claimToken).run();
  if (Number(finalized.meta.changes ?? 0) !== 1) throw new Error('AI_LOOP_SLACK_REPORT_CLAIM_LOST');
  return { action: previous?.slack_ts || previous?.claim_token ? 'updated' : 'created', ts: slackTs };
}
