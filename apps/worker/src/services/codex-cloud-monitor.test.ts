import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';
import {
  classifyOfficialCodexMessage,
  extractChatGptTaskUrl,
  hasActualSlackMention,
  parseSlackEventEnvelope,
  processCodexMentionMessage,
} from './codex-cloud-monitor.js';

afterEach(() => vi.unstubAllGlobals());

function queueTestEnv(status: 'detected' | 'official_running' = 'detected'): {
  env: Env['Bindings'];
  queueSend: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
} {
  const row = {
    slack_event_id: 'Ev-1',
    channel_id: 'C-1',
    message_ts: '100.1',
    thread_ts: '100.1',
    status,
    official_task_url: null,
    fallback_run_id: null,
    fallback_conversation_url: null,
  };
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(sql.includes('SELECT slack_event_id') ? row : null),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }),
  }));
  const queueSend = vi.fn().mockResolvedValue(undefined);
  return {
    env: {
      DB: { prepare } as unknown as D1Database,
      IMAGES: {} as R2Bucket,
      RAW_MAIL: {} as R2Bucket,
      ASSETS: {} as Fetcher,
      LINE_CHANNEL_SECRET: 'line-secret',
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
      API_KEY: 'api-key',
      LIFF_URL: 'https://liff.example.test',
      LINE_CHANNEL_ID: 'line-channel',
      LINE_LOGIN_CHANNEL_ID: 'login-channel',
      LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
      WORKER_URL: 'https://worker.example.test',
      SLACK_BOT_TOKEN: 'xoxb-test',
      WORKSPACE_AGENT_TRIGGER_ID: 'agtch_test',
      WORKSPACE_AGENT_ACCESS_TOKEN: 'agent-access-token',
      CODEX_MENTION_QUEUE: { send: queueSend } as unknown as Queue,
    },
    queueSend,
    prepare,
  };
}

const inspectMessage = {
  kind: 'inspect_official' as const,
  slackEventId: 'Ev-1',
  teamId: 'T-1',
  channelId: 'C-1',
  messageTs: '100.1',
  threadTs: '100.1',
  requesterUserId: 'U-MASATO',
  prompt: '<@U-CODEX> D-8を確認してください',
};

describe('Codex cloud monitor event classification', () => {
  test('Slackの実メンションだけを対象にする', () => {
    expect(hasActualSlackMention('<@U-CODEX> D-8を確認してください', 'U-CODEX')).toBe(true);
    expect(hasActualSlackMention('@Codex D-8を確認してください', 'U-CODEX')).toBe(false);
    expect(hasActualSlackMention('<@U-OTHER> D-8を確認してください', 'U-CODEX')).toBe(false);
  });

  test('公式Codexのタスクリンクを受領サインにする', () => {
    const text = 'On it — <https://chatgpt.com/s/cd_6a8ce9cf5f848191a23b49f56901463|View task>';
    expect(extractChatGptTaskUrl(text)).toBe('https://chatgpt.com/s/cd_6a8ce9cf5f848191a23b49f56901463');
    expect(classifyOfficialCodexMessage(text)).toEqual({
      state: 'running',
      taskUrl: 'https://chatgpt.com/s/cd_6a8ce9cf5f848191a23b49f56901463',
    });
  });

  test('接続失敗を公式経路の成功扱いにしない', () => {
    expect(classifyOfficialCodexMessage('環境の選択に失敗しました。停止します。').state).toBe('failed');
  });

  test('明示的な完了返信を完了扱いにする', () => {
    expect(classifyOfficialCodexMessage('監査が完了しました。').state).toBe('completed');
  });

  test('Slack envelopeを壊れたJSONから安全に分離する', () => {
    expect(parseSlackEventEnvelope('{')).toBeNull();
    expect(parseSlackEventEnvelope('{"type":"event_callback"}')).toEqual({ type: 'event_callback' });
  });

  test('公式受領がなければ冪等キー付きでWorkspace Agentを1回起動する', async () => {
    const current = queueTestEnv();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        conversation_url: 'https://chatgpt.com/c/fallback-1',
        agent_trigger_run_id: 'run-1',
      }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    await processCodexMentionMessage(current.env, inspectMessage);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const triggerRequest = fetcher.mock.calls[0] as [string, RequestInit];
    expect(triggerRequest[0]).toContain('/workspace_agents/agtch_test/trigger');
    expect(new Headers(triggerRequest[1].headers).get('idempotency-key')).toBe('slack:T-1:C-1:100.1');
    expect(JSON.parse(String(triggerRequest[1].body))).toMatchObject({
      conversation_key: 'slack:T-1:C-1:100.1',
    });
    expect(current.queueSend).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'inspect_fallback', runId: 'run-1', attempt: 1,
    }), { delaySeconds: 60 });
  });

  test('公式Codexが受領済みならWorkspace Agentを起動しない', async () => {
    const current = queueTestEnv('official_running');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await processCodexMentionMessage(current.env, inspectMessage);
    expect(fetcher).not.toHaveBeenCalled();
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('Workspace Agent設定が欠けていれば実行せずSlackへ設定待ちを通知する', async () => {
    const current = queueTestEnv();
    delete current.env.WORKSPACE_AGENT_ACCESS_TOKEN;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    await processCodexMentionMessage(current.env, inspectMessage);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://slack.com/api/chat.postMessage');
    expect(current.queueSend).not.toHaveBeenCalled();
  });
});
