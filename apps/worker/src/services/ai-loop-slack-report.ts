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
const MAX_HISTORY_PAGES = 3;

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
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function reportKey(report: AiLoopReport): string {
  return `ai-loop:${report.repository}:${report.taskId}`;
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
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
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
  const existing = await findExisting(token, channel, key, fetcher);
  const previousRevision = Number(existing?.metadata?.event_payload?.revision ?? -1);
  if (existing?.ts && Number.isFinite(previousRevision) && previousRevision >= report.revision) {
    return { action: 'ignored', ts: existing.ts };
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

  if (existing?.ts) {
    await slackApi(token, 'chat.update', { ...payload, ts: existing.ts }, fetcher);
    return { action: 'updated', ts: existing.ts };
  }
  const created = await slackApi(token, 'chat.postMessage', payload, fetcher);
  return { action: 'created', ts: created.ts };
}
