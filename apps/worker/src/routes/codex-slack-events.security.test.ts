import { afterEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { signSupportRelay } from '../services/support-relay.js';
import { signSlackRequest } from '../services/slack-signature.js';
import { TASK_ACTION_ID } from '../services/codex-slack-relay.js';
import { codexSlackEvents } from './codex-slack-events.js';

const payload = {
  version: 1,
  eventId: 'session-1:turn-1:prompt_submitted',
  eventType: 'prompt_submitted',
  sessionId: 'session-1',
  operator: 'kenta',
  repository: 'owner/line-harness-nen',
  branch: 'codex/kenta-test',
  prNumber: 220,
  content: 'PR #220の修正を進める',
  occurredAt: '2026-08-21T01:00:00.000Z',
};

function app() {
  const instance = new Hono<Env>();
  instance.route('/', codexSlackEvents);
  return instance;
}

function env(): Env['Bindings'] {
  return {
    DB: {} as D1Database,
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
    CODEX_SLACK_RELAY_SECRET: 'relay-secret',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
  };
}

function monitorEnv(options: { inserted?: boolean } = {}): {
  bindings: Env['Bindings'];
  queueSend: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn().mockResolvedValue({ meta: { changes: options.inserted === false ? 0 : 1 } });
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  const queueSend = vi.fn().mockResolvedValue(undefined);
  return {
    bindings: {
      ...env(),
      DB: { prepare } as unknown as D1Database,
      SLACK_SIGNING_SECRET: 'slack-signing-secret',
      CODEX_SLACK_USER_ID: 'U-CODEX',
      CODEX_ALLOWED_TEAM_IDS: 'T-1',
      CODEX_ALLOWED_CHANNEL_IDS: 'C-1',
      CODEX_RELAY_SOURCE_USER_IDS: 'U-MASATO',
      CODEX_RELAY_ENABLED: 'true',
      CODEX_MENTION_QUEUE: { send: queueSend } as unknown as Queue,
    },
    queueSend,
    prepare,
  };
}

async function slackHeaders(body: string, secret = 'slack-signing-secret') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'content-type': 'application/json',
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': await signSlackRequest(secret, timestamp, body),
  };
}

async function signedHeaders(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'content-type': 'application/json',
    'x-nen-timestamp': timestamp,
    'x-nen-signature': await signSupportRelay('relay-secret', timestamp, body),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Codex Slack relay security boundary', () => {
  test('署名のない送信をSlackへ流さない', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, env());
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('署名済みの送信だけをSlackの対象スレッドへ流す', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, messages: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, ts: '123.456' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, ts: '123.789' })));
    vi.stubGlobal('fetch', fetcher);
    const body = JSON.stringify(payload);
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST', headers: await signedHeaders(body), body,
    }, env());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      category: 'fix',
      channelId: 'C-PR',
      threadTs: '123.456',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test('秘密設定がない状態では動かさない', async () => {
    const current = env();
    delete current.CODEX_SLACK_RELAY_SECRET;
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST', body: JSON.stringify(payload),
    }, current);
    expect(response.status).toBe(503);
  });

  test('未定義の再照合モードを署名済みでも拒否する', async () => {
    const body = JSON.stringify({ ...payload, eventSource: 'github', syncMode: 'unknown' });
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST', headers: await signedHeaders(body), body,
    }, env());
    expect(response.status).toBe(400);
  });

  test('指令盤更新フラグはboolean以外を拒否する', async () => {
    const body = JSON.stringify({ ...payload, eventSource: 'github', refreshCommandCenter: 'yes' });
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST', headers: await signedHeaders(body), body,
    }, env());
    expect(response.status).toBe(400);
  });

  test('指令盤専用フラグはboolean以外を拒否する', async () => {
    const body = JSON.stringify({ ...payload, eventSource: 'github', commandCenterOnly: 'yes' });
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST', headers: await signedHeaders(body), body,
    }, env());
    expect(response.status).toBe(400);
  });

  test('Slack署名済みの完了ボタンだけを処理する', async () => {
    const current = env();
    current.SLACK_TASK_CHANNEL_ID = 'C-TASK';
    current.SLACK_SIGNING_SECRET = 'slack-signing-secret';
    current.SLACK_KENTA_USER_ID = 'U-KENTA';
    const actionPayload = {
      type: 'block_actions',
      user: { id: 'U-KENTA' },
      channel: { id: 'C-TASK' },
      message: { ts: '1787326497.583159', text: '【要対応】' },
      actions: [{
        action_id: TASK_ACTION_ID,
        value: JSON.stringify({
          status: 'done',
          key: 'pr:220',
          sourceChannel: 'C0SOURCE123',
          sourceThreadTs: '1787326000.000001',
        }),
      }],
    };
    const body = `payload=${encodeURIComponent(JSON.stringify(actionPayload))}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signSlackRequest('slack-signing-secret', timestamp, body);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, ts: '1787326000.000002' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, ts: '1787326497.583159' })));
    vi.stubGlobal('fetch', fetcher);

    const response = await app().request('/api/integrations/slack/actions', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
      body,
    }, current);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: 'done' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('Slack署名のないボタン操作を拒否する', async () => {
    const current = env();
    current.SLACK_TASK_CHANNEL_ID = 'C-TASK';
    current.SLACK_SIGNING_SECRET = 'slack-signing-secret';
    const response = await app().request('/api/integrations/slack/actions', {
      method: 'POST',
      body: 'payload=%7B%7D',
    }, current);
    expect(response.status).toBe(401);
  });

  test('Slack URL verificationへ署名確認後にchallengeを返す', async () => {
    const current = monitorEnv();
    const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge-value' });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('challenge-value');
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('Codex監視専用の署名秘密を既存Slackアプリの署名秘密から分離する', async () => {
    const current = monitorEnv();
    current.bindings.CODEX_SLACK_MONITOR_SIGNING_SECRET = 'codex-monitor-signing-secret';
    const body = JSON.stringify({ type: 'url_verification', challenge: 'monitor-challenge' });

    const oldApp = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(oldApp.status).toBe(401);

    const monitorApp = await app().request('/api/integrations/slack/events', {
      method: 'POST',
      headers: await slackHeaders(body, 'codex-monitor-signing-secret'),
      body,
    }, current.bindings);
    expect(monitorApp.status).toBe(200);
    expect(await monitorApp.text()).toBe('monitor-challenge');
  });

  test('実メンションを台帳へ記録して30秒後の確認だけを予約する', async () => {
    const current = monitorEnv();
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: 'Ev-1',
      team_id: 'T-1',
      event: {
        type: 'app_mention',
        user: 'U-MASATO',
        text: '[claude->codex]\n<@U-CODEX> D-8を確認してください',
        channel: 'C-1',
        ts: '1787619782.181509',
      },
    });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, queued: true });
    expect(current.prepare).toHaveBeenCalledTimes(1);
    expect(current.queueSend).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'inspect_official',
      slackEventId: 'Ev-1',
      threadTs: '1787619782.181509',
    }), { delaySeconds: 30 });
  });

  test('許可されていないteamまたはchannelのイベントを記録せず捨てる', async () => {
    for (const [teamId, channelId] of [['T-OTHER', 'C-1'], ['T-1', 'C-OTHER']]) {
      const current = monitorEnv();
      const body = JSON.stringify({
        type: 'event_callback', event_id: `Ev-${teamId}-${channelId}`, team_id: teamId,
        event: {
          type: 'app_mention', user: 'U-MASATO',
          text: '[claude->codex]\n<@U-CODEX> D-8', channel: channelId, ts: '3.0',
        },
      });
      const response = await app().request('/api/integrations/slack/events', {
        method: 'POST', headers: await slackHeaders(body), body,
      }, current.bindings);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, ignored: true });
      expect(current.prepare).not.toHaveBeenCalled();
      expect(current.queueSend).not.toHaveBeenCalled();
    }
  });

  test('新しい帯チャンネルはSlack実名の接頭辞照合後に監視へ入る', async () => {
    const current = monitorEnv();
    current.bindings.CODEX_ALLOWED_CHANNEL_NAME_PREFIXES = 'line-harness-pr-';
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      channel: { name: 'line-harness-pr-401-500', is_archived: false },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const body = JSON.stringify({
      type: 'event_callback', event_id: 'Ev-next-band', team_id: 'T-1',
      event: {
        type: 'app_mention', user: 'U-MASATO',
        text: '[claude->codex]\n<@U-CODEX> 次の帯を確認', channel: 'C-401-500', ts: '3.1',
      },
    });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, queued: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(current.prepare).toHaveBeenCalledTimes(1);
  });

  test('マーカーなしの実メンションは台帳へ記録するが中継予約しない', async () => {
    const current = monitorEnv();
    const body = JSON.stringify({
      type: 'event_callback', event_id: 'Ev-no-marker', team_id: 'T-1',
      event: {
        type: 'app_mention', user: 'U-MASATO', text: '<@U-CODEX> 手動の会話',
        channel: 'C-1', ts: '4.0',
      },
    });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, recorded: true, queued: false });
    expect(current.prepare).toHaveBeenCalledTimes(2);
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('キルスイッチ無効時はマーカー付きでも台帳記録だけにする', async () => {
    const current = monitorEnv();
    current.bindings.CODEX_RELAY_ENABLED = 'false';
    const body = JSON.stringify({
      type: 'event_callback', event_id: 'Ev-kill-switch', team_id: 'T-1',
      event: {
        type: 'app_mention', user: 'U-MASATO',
        text: '[claude->codex]\n<@U-CODEX> D-8', channel: 'C-1', ts: '4.5',
      },
    });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, recorded: true, queued: false });
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('Worker自身の自動中継マーカーを再検知しても台帳へ記録しない', async () => {
    const current = monitorEnv();
    const body = JSON.stringify({
      type: 'event_callback', event_id: 'Ev-relay-loop', team_id: 'T-1',
      event: {
        type: 'app_mention', user: 'U-MASATO',
        text: '【Claude依頼の自動中継】\n<@U-CODEX> 中継済み', channel: 'C-1', ts: '5.0',
      },
    });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, ignored: true });
    expect(current.prepare).not.toHaveBeenCalled();
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('Slack再送で同じmessage_tsが記録済みなら二重予約しない', async () => {
    const current = monitorEnv({ inserted: false });
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: 'Ev-retry',
      team_id: 'T-1',
      event: {
        type: 'message', user: 'U-MASATO', text: '[claude->codex]\n<@U-CODEX> D-8',
        channel: 'C-1', ts: '1787619782.181509',
      },
    });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, queued: false });
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('文字列の@Codexや署名のないイベントは監視へ入れない', async () => {
    const current = monitorEnv();
    const body = JSON.stringify({
      type: 'event_callback', event_id: 'Ev-2', team_id: 'T-1',
      event: { type: 'message', user: 'U-MASATO', text: '@Codex D-8', channel: 'C-1', ts: '2.0' },
    });
    const signed = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(signed.status).toBe(200);
    expect(current.prepare).not.toHaveBeenCalled();
    const unsigned = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }, current.bindings);
    expect(unsigned.status).toBe(401);
    expect(current.queueSend).not.toHaveBeenCalled();
  });

  test('許可済み投稿者の固定監査合図だけを自動マージ確認へ予約する', async () => {
    const current = monitorEnv();
    current.bindings.CODEX_RELAY_SOURCE_USER_IDS = 'U-CLAUDE';
    current.bindings.CODEX_RELAY_ENABLED = 'false';
    const body = JSON.stringify({
      type: 'event_callback', event_id: 'Ev-audit-344', team_id: 'T-1',
      event: {
        type: 'message', user: 'U-CLAUDE',
        text: '[claude->codex]\n【監査結果】PR #344 合格・統合可',
        channel: 'C-1', ts: '6.0', thread_ts: '5.0',
      },
    });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, autoMergeQueued: true });
    expect(current.queueSend).toHaveBeenCalledTimes(1);
    expect(current.queueSend).toHaveBeenCalledWith({
      kind: 'auto_merge',
      slackEventId: 'Ev-audit-344',
      channelId: 'C-1',
      threadTs: '5.0',
      requesterUserId: 'U-CLAUDE',
      prNumber: 344,
    });
    expect(current.prepare).not.toHaveBeenCalled();
  });

  test.each([
    ['合図なし', 'U-CLAUDE', '[claude->codex]\nPR #344をお願いします'],
    ['書式違い', 'U-CLAUDE', '[claude->codex]\n【監査結果】PR #344 条件付き合格'],
    ['許可リスト外', 'U-OTHER', '[claude->codex]\n【監査結果】PR #344 合格・統合可'],
  ])('%sなら自動マージ確認へ予約しない', async (_case, user, text) => {
    const current = monitorEnv();
    current.bindings.CODEX_RELAY_SOURCE_USER_IDS = 'U-CLAUDE';
    const body = JSON.stringify({
      type: 'event_callback', event_id: `Ev-reject-${user}`, team_id: 'T-1',
      event: { type: 'message', user, text, channel: 'C-1', ts: '6.1', thread_ts: '5.0' },
    });
    const response = await app().request('/api/integrations/slack/events', {
      method: 'POST', headers: await slackHeaders(body), body,
    }, current.bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, ignored: true });
    expect(current.queueSend).not.toHaveBeenCalled();
    expect(current.prepare).not.toHaveBeenCalled();
  });
});
