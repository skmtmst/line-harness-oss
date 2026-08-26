import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';
import {
  classifyCodexMonitorError,
  createCodexQueueFailureLog,
  classifyOfficialCodexMessage,
  extractChatGptTaskUrl,
  hasActualSlackMention,
  hasClaudeToCodexMarker,
  hasConfiguredRelayChannelGate,
  isAllowedRelayChannel,
  isAllowedRelaySource,
  isAutomaticCodexRelay,
  isCodexRelayEnabled,
  parseSlackEventEnvelope,
  processCodexMentionMessage,
  requiresExplicitApproval,
  shouldStopCodexQueueRetry,
  type CodexMonitorStatus,
} from './codex-cloud-monitor.js';

afterEach(() => vi.unstubAllGlobals());

function queueTestEnv(status: CodexMonitorStatus = 'detected'): {
  env: Env['Bindings'];
  queueSend: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
} {
  let currentStatus: CodexMonitorStatus = status;
  const row = {
    slack_event_id: 'Ev-1',
    channel_id: 'C-1',
    message_ts: '100.1',
    thread_ts: '100.1',
    official_task_url: null,
    fallback_run_id: null,
    fallback_conversation_url: null,
  };
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: vi.fn().mockReturnValue({
      first: vi.fn().mockImplementation(async () => (
        sql.includes('SELECT slack_event_id') ? { ...row, status: currentStatus } : null
      )),
      run: vi.fn().mockImplementation(async () => {
        if (sql.includes("SET status = 'fallback_starting'")) {
          if (currentStatus !== 'detected') return { meta: { changes: 0 } };
          currentStatus = 'fallback_starting';
        } else if (sql.includes("SET status = 'fallback_running'")) {
          if (currentStatus !== 'fallback_starting') return { meta: { changes: 0 } };
          currentStatus = 'fallback_running';
        }
        return { meta: { changes: 1 } };
      }),
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
      SLACK_USER_TOKEN: 'xoxp-test',
      CODEX_SLACK_USER_ID: 'U-CODEX',
      CODEX_ALLOWED_TEAM_IDS: 'T-1',
      CODEX_ALLOWED_CHANNEL_IDS: 'C-1',
      CODEX_RELAY_SOURCE_USER_IDS: 'U-CLAUDE,U-OTHER-BOT',
      CODEX_RELAY_ENABLED: 'true',
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
  requesterUserId: 'U-CLAUDE',
  prompt: '[claude->codex]\n<@U-CODEX> D-8を確認してください',
};

describe('Codex cloud monitor event classification', () => {
  test('生とSlackエスケープ済みのClaude合図を対象にする', () => {
    expect(hasClaudeToCodexMarker('[claude->codex]\n依頼')).toBe(true);
    expect(hasClaudeToCodexMarker('[claude-&gt;codex]\n依頼')).toBe(true);
    expect(hasClaudeToCodexMarker('[claude-&amp;gt;codex]\n依頼')).toBe(false);
  });

  test('Slackの実メンションだけを対象にする', () => {
    expect(hasActualSlackMention('<@U-CODEX> D-8を確認してください', 'U-CODEX')).toBe(true);
    expect(hasActualSlackMention('<@U-CODEX|Codex> D-8を確認してください', 'U-CODEX')).toBe(
      true,
    );
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

  test('自動中継マーカー、許可元、承認対象を判定する', () => {
    expect(isAutomaticCodexRelay('【Claude依頼の自動中継】\n<@U-CODEX>')).toBe(true);
    expect(isAutomaticCodexRelay('<@U-CODEX> 通常依頼')).toBe(false);
    expect(isAllowedRelaySource('U-CLAUDE, U-OTHER', 'U-CLAUDE')).toBe(true);
    expect(isAllowedRelaySource('U-CLAUDE, U-OTHER', 'U-MASATO')).toBe(false);
    expect(isCodexRelayEnabled('true')).toBe(true);
    expect(isCodexRelayEnabled('false')).toBe(false);
    expect(requiresExplicitApproval('開発環境で型検査をしてください')).toBe(false);
    expect(requiresExplicitApproval('本番DBを更新してください')).toBe(true);
    expect(requiresExplicitApproval('対象は開発のみ。本番には変更を加えないでください')).toBe(false);
    expect(requiresExplicitApproval('Slack OAuth設定はMasatoの承認後に行ってください')).toBe(false);
  });

  test('帯チャンネルは設定した接頭辞と3桁-3桁だけからなる実名を許可する', async () => {
    const names = [
      'line-harness-pr-301-400',
      'custom.range+401-500',
      'line-harness-pr-test',
      'line-harness-pr-',
      'line-harness-pr-1-2',
    ];
    const fetcher = vi.fn<typeof fetch>();
    for (const name of names) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        channel: { name, is_archived: false },
      }), { status: 200 }));
    }
    const config = {
      SLACK_BOT_TOKEN: 'xoxb-test',
      CODEX_ALLOWED_CHANNEL_IDS: 'C-301-400',
      CODEX_ALLOWED_CHANNEL_NAME_PREFIXES: 'line-harness-pr-, custom.range+',
    };

    expect(await isAllowedRelayChannel(config, 'C-RANGE-1', fetcher)).toBe(true);
    expect(await isAllowedRelayChannel(config, 'C-RANGE-2', fetcher)).toBe(true);
    expect(await isAllowedRelayChannel(config, 'C-TEST', fetcher)).toBe(false);
    expect(await isAllowedRelayChannel(config, 'C-EMPTY', fetcher)).toBe(false);
    expect(await isAllowedRelayChannel(config, 'C-SHORT', fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('conversations.info?channel=C-RANGE-1');
  });

  test('接頭辞の未設定・不一致・Slack照合失敗・アーカイブ済みは閉じる', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      channel: { name: 'general', is_archived: false },
    }), { status: 200 }));
    expect(hasConfiguredRelayChannelGate(undefined, undefined)).toBe(false);
    expect(await isAllowedRelayChannel({}, 'C-OTHER', fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await isAllowedRelayChannel({
      SLACK_BOT_TOKEN: 'xoxb-test',
      CODEX_ALLOWED_CHANNEL_NAME_PREFIXES: 'line-harness-pr-',
    }, 'C-OTHER', fetcher)).toBe(false);

    const rejected = vi.fn<typeof fetch>().mockRejectedValue(new Error('network contains secret'));
    expect(await isAllowedRelayChannel({
      SLACK_BOT_TOKEN: 'xoxb-test',
      CODEX_ALLOWED_CHANNEL_NAME_PREFIXES: 'line-harness-pr-',
    }, 'C-OTHER', rejected)).toBe(false);

    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'channel_not_found',
    }), { status: 200 }));
    expect(await isAllowedRelayChannel({
      SLACK_BOT_TOKEN: 'xoxb-test',
      CODEX_ALLOWED_CHANNEL_NAME_PREFIXES: 'line-harness-pr-',
    }, 'C-OTHER', failed)).toBe(false);

    const archived = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      channel: { name: 'line-harness-pr-301-400', is_archived: true },
    }), { status: 200 }));
    expect(await isAllowedRelayChannel({
      SLACK_BOT_TOKEN: 'xoxb-test',
      CODEX_ALLOWED_CHANNEL_NAME_PREFIXES: 'line-harness-pr-',
    }, 'C-OTHER', archived)).toBe(false);
  });

  test('完全一致IDはSlack APIを呼ばずに許可する', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await isAllowedRelayChannel({
      CODEX_ALLOWED_CHANNEL_IDS: 'C-301-400,C-401-500',
    }, 'C-401-500', fetcher)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('例外本文を保持せず運用分類だけへ変換する', () => {
    expect(classifyCodexMonitorError(Object.assign(new Error('private row'), { name: 'D1Error' }))).toBe('db_error');
    expect(classifyCodexMonitorError(new Error('SLACK_USER_RELAY_FAILED:token_revoked'))).toBe('slack_api_error');
    expect(classifyCodexMonitorError(new Error('private prompt text'))).toBe('unknown');
  });

  test('Queueは設定回数に達したときだけ再試行を終了する', () => {
    expect(shouldStopCodexQueueRetry(4, '5')).toBe(false);
    expect(shouldStopCodexQueueRetry(5, '5')).toBe(true);
    expect(shouldStopCodexQueueRetry(5, 'invalid')).toBe(true);
  });

  test('Queue失敗ログで再試行の終了有無を区別できる', () => {
    const base = {
      kind: 'inspect',
      slackEventId: 'Ev-test',
      reason: 'unknown',
      attempts: 5,
    } as const;
    expect(createCodexQueueFailureLog({ ...base, stopped: true })).toMatchObject({ stopped: true });
    expect(createCodexQueueFailureLog({ ...base, stopped: false })).toMatchObject({ stopped: false });
  });

  test('公式受領がなければ許可済み投稿をUser OAuthで1回中継する', async () => {
    const current = queueTestEnv();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, messages: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    await processCodexMentionMessage(current.env, {
      ...inspectMessage,
      prompt: '[claude->codex]\n<@U-CODEX|Codex> D-8を確認してください',
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://slack.com/api/conversations.replies?');
    const relayRequest = fetcher.mock.calls[1] as [string, RequestInit];
    expect(relayRequest[0]).toBe('https://slack.com/api/chat.postMessage');
    expect(new Headers(relayRequest[1].headers).get('authorization')).toBe('Bearer xoxp-test');
    expect(JSON.parse(String(relayRequest[1].body))).toMatchObject({
      channel: 'C-1',
      thread_ts: '100.1',
    });
    expect(String(JSON.parse(String(relayRequest[1].body)).text)).toContain('【Claude依頼の自動中継】');
    expect(String(JSON.parse(String(relayRequest[1].body)).text)).toContain('<@U-CODEX>');
    expect(String(JSON.parse(String(relayRequest[1].body)).text)).not.toContain('|Codex>');
    expect(String(JSON.parse(String(relayRequest[1].body)).text)).toContain('下書きPR');
    expect(current.queueSend).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'inspect_relay', slackEventId: 'Ev-1',
    }), { delaySeconds: 300 });
  });

  test('公式Codexが受領済みなら自動中継しない', async () => {
    const current = queueTestEnv('official_running');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await processCodexMentionMessage(current.env, inspectMessage);
    expect(fetcher).not.toHaveBeenCalled();
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('中継後のQueue送信結果が不明でも中継を再投稿せず受領確認だけを復元する', async () => {
    const current = queueTestEnv('fallback_running');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await processCodexMentionMessage(current.env, inspectMessage);
    expect(fetcher).not.toHaveBeenCalled();
    expect(current.queueSend).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'inspect_relay', slackEventId: 'Ev-1',
    }), { delaySeconds: 300 });
  });

  test('自動中継直前のSlack再照合で公式タスクを見つけたら中継しない', async () => {
    const current = queueTestEnv();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      messages: [{
        user: 'U-CODEX',
        text: 'On it — https://chatgpt.com/s/cd_existing',
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    await processCodexMentionMessage(current.env, inspectMessage);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('User OAuth設定が欠けていれば中継せずSlackへ設定待ちを通知する', async () => {
    const current = queueTestEnv();
    delete current.env.SLACK_USER_TOKEN;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    await processCodexMentionMessage(current.env, inspectMessage);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://slack.com/api/chat.postMessage');
    expect(new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers).get('authorization')).toBe('Bearer xoxb-test');
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('許可リスト外の投稿者は公式Codexへ中継しない', async () => {
    const current = queueTestEnv();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    await processCodexMentionMessage(current.env, {
      ...inspectMessage,
      requesterUserId: 'U-NOT-ALLOWED',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers).get('authorization')).toBe('Bearer xoxb-test');
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('明示承認が必要な依頼は自動中継せず承認待ちにする', async () => {
    const current = queueTestEnv();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    await processCodexMentionMessage(current.env, {
      ...inspectMessage,
      prompt: '[claude->codex]\n<@U-CODEX> 本番DBを更新してください',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body)).text)).toContain('【承認待ち】');
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('中継後5分で公式受領がなければ再中継せず通知する', async () => {
    const current = queueTestEnv('fallback_running');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, messages: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await processCodexMentionMessage(current.env, {
      kind: 'inspect_relay',
      slackEventId: 'Ev-1',
      channelId: 'C-1',
      threadTs: '100.1',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(JSON.parse(String((fetcher.mock.calls[1]?.[1] as RequestInit).body)).text)).toContain('【受領未確認】');
    expect(current.queueSend).not.toHaveBeenCalled();
  });
});
