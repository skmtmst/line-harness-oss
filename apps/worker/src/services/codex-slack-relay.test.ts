import { describe, expect, test, vi } from 'vitest';
import {
  buildSlackCommandCenterText,
  classifyCodexSlackEvent,
  handleSlackTaskAction,
  harnessErrorIncidentKey,
  isCodexTaskCompletion,
  ensureUpcomingPrRangeChannel,
  nextPrRangeStartToPrepare,
  prRangeChannelName,
  prRangeKey,
  replaceErrorParentStatusText,
  reportHarnessErrorToSlack,
  relayCodexSlackEvent,
  resolveCodexSlackChannel,
  resolveCodexSlackChannelWithProvisioning,
  sanitizeSlackContent,
  shouldTrackCodexTask,
  TASK_ACTION_ID,
  taskIdForKey,
  type CodexSlackEvent,
} from './codex-slack-relay.js';

function event(overrides: Partial<CodexSlackEvent> = {}): CodexSlackEvent {
  return {
    version: 1,
    eventId: 'session-1:turn-1:prompt_submitted',
    eventType: 'prompt_submitted',
    sessionId: 'session-1',
    operator: 'kenta',
    content: '予約画面の修正を進めて',
    occurredAt: '2026-08-21T01:00:00.000Z',
    ...overrides,
  };
}

function slackResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Codex Slack relay', () => {
  test('エラー、正本化するアイデア、承認待ちを分類する', () => {
    expect(classifyCodexSlackEvent(event({ content: '白い画面で動かない' }))).toBe('error');
    expect(classifyCodexSlackEvent(event({ content: 'この会話を正本化して' }))).toBe('idea');
    expect(classifyCodexSlackEvent(event({ eventType: 'approval_required' }))).toBe('decision');
    expect(classifyCodexSlackEvent(event({ prNumber: 220 }))).toBe('fix');
    expect(classifyCodexSlackEvent(event({ prNumber: 250, content: 'Slackエラー対応が完了しました' }))).toBe('fix');
  });

  test('PR番号を100件単位のチャンネルに振り分ける', () => {
    expect(prRangeKey(1)).toBe('1-100');
    expect(prRangeKey(100)).toBe('1-100');
    expect(prRangeKey(101)).toBe('101-200');
    expect(prRangeKey(220)).toBe('201-300');
    expect(prRangeKey(301)).toBe('301-400');
    expect(prRangeChannelName(1)).toBe('line-harness-pr-001-100');
    expect(prRangeChannelName(301)).toBe('line-harness-pr-301-400');
    expect(nextPrRangeStartToPrepare(289)).toBeNull();
    expect(nextPrRangeStartToPrepare(290)).toBe(301);
    expect(nextPrRangeStartToPrepare(300)).toBe(301);
    expect(nextPrRangeStartToPrepare(390)).toBe(401);
    expect(resolveCodexSlackChannel({
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-DEFAULT',
      SLACK_PR_CHANNELS_JSON: JSON.stringify({ '201-300': 'C-201-300' }),
    }, 'fix', 220)).toBe('C-201-300');
  });

  test('PR #301以降は作成済みの100件単位チャンネルを名前から解決する', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({
        channels: [{ id: 'C-301-400', name: 'line-harness-pr-301-400', is_archived: false }],
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'already_in_channel' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'already_in_channel' })))
      .mockResolvedValueOnce(slackResponse({}));

    const channelId = await resolveCodexSlackChannelWithProvisioning({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-DEFAULT',
      SLACK_PR_CHANNELS_JSON: JSON.stringify({ '201-300': 'C-201-300' }),
      SLACK_KENTA_USER_ID: 'U-KENTA',
      SLACK_MASATO_USER_ID: 'U-MASATO',
      CODEX_SLACK_USER_ID: 'U-CODEX',
    }, 'fix', 301, fetcher);

    expect(channelId).toBe('C-301-400');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('conversations.list');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('conversations.invite');
    expect(String(fetcher.mock.calls[2]?.[0])).toContain('conversations.invite');
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('conversations.invite');
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({
      channel: 'C-301-400',
      users: 'U-CODEX',
    });
  });

  test('PR #290で301-400チャンネルを先行作成する', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ channels: [] }))
      .mockResolvedValueOnce(slackResponse({
        channel: { id: 'C-301-400', name: 'line-harness-pr-301-400' },
      }))
      .mockResolvedValueOnce(slackResponse({}))
      .mockResolvedValueOnce(slackResponse({}));

    const channelId = await ensureUpcomingPrRangeChannel({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_KENTA_USER_ID: 'U-KENTA',
      SLACK_MASATO_USER_ID: 'U-MASATO',
    }, 290, fetcher);

    expect(channelId).toBe('C-301-400');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('conversations.create');
    const request = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(request).toEqual({ name: 'line-harness-pr-301-400', is_private: false });
    expect(String(fetcher.mock.calls[2]?.[0])).toContain('conversations.invite');
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('conversations.invite');
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      channel: 'C-301-400',
      users: 'U-KENTA',
    });
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({
      channel: 'C-301-400',
      users: 'U-MASATO',
    });
  });

  test('PR #390で401-500チャンネルを先行作成しCodexも招待する', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ channels: [] }))
      .mockResolvedValueOnce(slackResponse({
        channel: { id: 'C-401-500', name: 'line-harness-pr-401-500' },
      }))
      .mockResolvedValueOnce(slackResponse({}))
      .mockResolvedValueOnce(slackResponse({}))
      .mockResolvedValueOnce(slackResponse({}));

    const channelId = await ensureUpcomingPrRangeChannel({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_KENTA_USER_ID: 'U-KENTA',
      SLACK_MASATO_USER_ID: 'U-MASATO',
      CODEX_SLACK_USER_ID: 'U-CODEX',
    }, 390, fetcher);

    expect(channelId).toBe('C-401-500');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      name: 'line-harness-pr-401-500',
      is_private: false,
    });
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      channel: 'C-401-500',
      users: 'U-KENTA',
    });
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({
      channel: 'C-401-500',
      users: 'U-MASATO',
    });
    expect(JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body))).toEqual({
      channel: 'C-401-500',
      users: 'U-CODEX',
    });
  });

  test('既に参加済みの利用者がいても残りの招待を続ける', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({
        channels: [{ id: 'C-401-500', name: 'line-harness-pr-401-500', is_archived: false }],
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'already_in_channel' })))
      .mockResolvedValueOnce(slackResponse({}));

    const channelId = await resolveCodexSlackChannelWithProvisioning({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_KENTA_USER_ID: 'U-KENTA',
      SLACK_MASATO_USER_ID: 'U-MASATO',
    }, 'fix', 401, fetcher);

    expect(channelId).toBe('C-401-500');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      channel: 'C-401-500',
      users: 'U-MASATO',
    });
  });

  test('次のPRチャンネル準備が失敗したらSlack投稿前に停止する', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: 'missing_scope',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-DEFAULT',
      SLACK_PR_CHANNELS_JSON: JSON.stringify({ '201-300': 'C-201-300' }),
    }, event({
      prNumber: 290,
      sessionId: 'github-pr-290',
      eventSource: 'github',
      syncMode: 'event',
    }), fetcher)).rejects.toThrow('SLACK_API_FAILED:conversations.list:200:missing_scope');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.every((call) => !String(call[0]).includes('chat.postMessage'))).toBe(true);
  });

  test('Slackに出す前に秘密値を隠す', () => {
    const content = sanitizeSlackContent('token=xoxb-123456789012-abcdefghijkl password=hunter2');
    expect(content).not.toContain('xoxb-123456789012-abcdefghijkl');
    expect(content).not.toContain('hunter2');
    expect(content).toContain('[REDACTED]');
  });

  test('エラー報告の親投稿は残したまま状態表示を完了へ更新する', () => {
    const original = '*【:warning: エラー報告】API 500*\n担当：Codex\n状態：:eyes: 確認待ち\n\n以降の確認・会話・Codexへの依頼は、このスレッドへ返信してください。';
    const completed = replaceErrorParentStatusText(original, 'done');
    expect(completed).toContain('状態：:white_check_mark: 完了');
    expect(completed).not.toContain('状態：:eyes: 確認待ち');
    expect(completed).toContain('以降の確認・会話・Codexへの依頼');
  });

  test('対応が必要な内容だけをタスク化し、未完了という報告は閉じない', () => {
    expect(shouldTrackCodexTask(event({ content: '予約画面の修正を進めて' }), 'fix')).toBe(true);
    expect(shouldTrackCodexTask(event({ content: '状況を教えて' }), 'decision')).toBe(false);
    expect(isCodexTaskCompletion(event({
      eventType: 'turn_completed',
      content: '予約画面の修正が完了しました',
    }))).toBe(true);
    expect(isCodexTaskCompletion(event({
      eventType: 'turn_completed',
      content: 'PR #249の修正が完了しました。同一エラーとして解決済みです',
    }))).toBe(true);
    expect(isCodexTaskCompletion(event({
      eventType: 'turn_completed',
      content: '修正は未完了で、エラーが残っています',
    }))).toBe(false);
    expect(isCodexTaskCompletion(event({
      eventType: 'turn_completed',
      eventSource: 'github',
      prNumber: 296,
      content: 'PR #296「Slack同期の1件失敗で後続PRを止めない」をマージし、対応が完了しました。',
    }))).toBe(true);
  });

  test('同じ作業キーから同じTASK-IDを生成する', () => {
    expect(taskIdForKey('pr:220')).toMatch(/^TASK-[0-9A-F]{16}$/);
    expect(taskIdForKey('pr:220')).toBe(taskIdForKey('pr:220'));
    expect(taskIdForKey('pr:220')).not.toBe(taskIdForKey('pr:221'));
  });

  test('Slack指令盤で担当、PR順、追い越し可否、反映状況、重複を一覧化する', () => {
    const text = buildSlackCommandCenterText([
      {
        number: 220,
        title: '飲食店向けテスト管理機能',
        url: 'https://github.com/example/repo/pull/220',
        author: 'skmtmst',
        headRefName: 'codex/masato-restaurant-test',
        isDraft: true,
        mergeStateStatus: 'UNKNOWN',
        updatedAt: '2026-08-20T00:00:00Z',
        fileCount: 28,
        overlapsWith: [254],
        checks: 'pass',
      },
      {
        number: 254,
        title: 'Slack指令盤',
        url: 'https://github.com/example/repo/pull/254',
        author: 'skmtmst',
        headRefName: 'codex/kenta-slack-command-center',
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        updatedAt: '2026-08-22T00:00:00Z',
        fileCount: 4,
        overlapsWith: [220],
        checks: 'pass',
      },
    ], [
      {
        taskId: 'TASK-0000000000000001',
        status: 'working',
        operator: 'ケンタ',
        title: 'Slack指令盤を作成中',
        prNumber: 254,
        sourceChannel: 'C0SOURCE123',
        sourceThreadTs: '1787326000.000001',
        workKey: 'pr:254:a',
        environment: 'development',
      },
      {
        taskId: 'TASK-0000000000000002',
        status: 'review',
        operator: 'ケンタ',
        title: '同じPRの確認待ち',
        prNumber: 254,
        sourceChannel: 'C0SOURCE999',
        sourceThreadTs: '1787326000.000002',
        workKey: 'pr:254:b',
        environment: 'staging',
      },
    ], '2026-08-22T01:00:00.000Z');

    expect(text).toContain('#220> マサト｜Draft');
    expect(text).toContain('#254> ケンタ｜統合可能');
    expect(text).toContain('追い越し不可（#220と変更重複）');
    expect(text).toContain('本番未反映');
    expect(text).toContain('停止理由：確認待ち');
    expect(text).toContain('PR #254 が 2件');
  });

  test('古いPRがDraftで変更重複がなければ後続PRを先に統合できると表示する', () => {
    const text = buildSlackCommandCenterText([
      {
        number: 220,
        title: '保留中',
        url: 'https://github.com/example/repo/pull/220',
        author: 'skmtmst',
        headRefName: 'codex/masato-hold',
        isDraft: true,
        mergeStateStatus: 'UNKNOWN',
        updatedAt: '2026-08-20T00:00:00Z',
        fileCount: 2,
        overlapsWith: [],
        checks: 'pass',
      },
      {
        number: 254,
        title: '先行可能',
        url: 'https://github.com/example/repo/pull/254',
        author: 'skmtmst',
        headRefName: 'codex/kenta-ready',
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        updatedAt: '2026-08-22T00:00:00Z',
        fileCount: 2,
        overlapsWith: [],
        checks: 'pass',
      },
    ], [], '2026-08-22T01:00:00.000Z');

    expect(text).toContain('追い越し候補（古いPRはDraft、変更重複なし）');
  });

  test('同じ画面のAPI 500と未処理Promiseを同じエラーとしてまとめる', () => {
    const direct = harnessErrorIncidentKey({
      source: 'admin',
      path: 'https://nen-line-stg-admin.pages.dev/friend-add-settings',
      message: 'API 500: /api/friends/add-breakdown?days=30',
    });
    const rejection = harnessErrorIncidentKey({
      source: 'admin',
      path: 'https://nen-line-stg-admin.pages.dev/friend-add-settings?account=secret',
      message: '[unhandledrejection] API error: 500',
    });

    expect(rejection).toBe(direct);
    expect(direct).not.toContain('secret');
  });

  test('既存のPR親スレッドへ作業報告を追記する', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({
        messages: [{
          ts: '123.456',
          metadata: {
            event_type: 'line_harness_codex',
            event_payload: { work_key: 'pr:220' },
          },
        }],
      }))
      .mockResolvedValueOnce(slackResponse({ ts: '123.789' }));

    const result = await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-DEFAULT',
      SLACK_PR_CHANNELS_JSON: JSON.stringify({ '201-300': 'C-201-300' }),
    }, event({ prNumber: 220 }), fetcher);

    expect(result).toEqual({ category: 'fix', channelId: 'C-201-300', threadTs: '123.456' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const reply = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(reply).toMatchObject({ channel: 'C-201-300', thread_ts: '123.456' });
  });

  test('GitHub再照合で既存スレッドと未完了カードが揃っていれば重複投稿しない', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({
        messages: [{
          ts: '300.001',
          metadata: {
            event_type: 'line_harness_task',
            event_payload: {
              work_key: 'pr:276',
              source_channel: 'C0PR123',
              source_thread_ts: '1787452000.000001',
            },
          },
        }],
      }));

    const result = await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C0PR123',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({
      eventId: 'github-pr:276:reconcile',
      sessionId: 'github-pr-276',
      operator: 'masato',
      prNumber: 276,
      syncMode: 'reconcile',
      eventSource: 'github',
      content: 'PR #276のSlack通知を再照合しました。',
    }), fetcher);

    expect(result.threadTs).toBe('1787452000.000001');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('GitHub再照合でマージ済みなのに未完了カードが残っていれば完了させる', async () => {
    const task = {
      ts: '300.001',
      metadata: {
        event_type: 'line_harness_task',
        event_payload: {
          work_key: 'pr:276',
          source_channel: 'C0PR123',
          source_thread_ts: '1787452000.000001',
        },
      },
    };
    const parent = {
      ts: '1787452000.000001',
      text: '*【:large_blue_circle: 修正・開発】PR #276を作成しました*\n担当：マサト\n状態：:large_blue_circle: 作業中',
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [task] }))
      .mockResolvedValueOnce(slackResponse({ messages: [parent] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ messages: [parent] }))
      .mockResolvedValueOnce(slackResponse({ ts: parent.ts }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C0PR123',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({
      eventId: 'github-pr:276:reconcile:merged',
      eventType: 'turn_completed',
      sessionId: 'github-pr-276',
      operator: 'masato',
      prNumber: 276,
      syncMode: 'reconcile',
      eventSource: 'github',
      content: 'PR #276をマージし、対応が完了しました。',
    }), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(6);
    const reply = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    const parentUpdate = JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body));
    const deletion = JSON.parse(String(fetcher.mock.calls[5]?.[1]?.body));
    expect(reply).toMatchObject({ channel: 'C0PR123', thread_ts: '1787452000.000001' });
    expect(parentUpdate.text).toContain('状態：:white_check_mark: 完了');
    expect(parentUpdate.metadata.event_payload).toMatchObject({
      work_key: 'pr:276',
      category: 'fix',
      status: 'done',
    });
    expect(deletion).toMatchObject({ channel: 'C-TASK', ts: '300.001' });
  });

  test('GitHub再照合で完了表示済みなら返信を重複させない', async () => {
    const parent = {
      ts: '1787452000.000001',
      text: '*【:large_blue_circle: 修正・開発】PR #276*\n状態：:white_check_mark: 完了',
      metadata: {
        event_type: 'line_harness_codex',
        event_payload: { work_key: 'pr:276', category: 'fix', status: 'done' },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ messages: [parent] }))
      .mockResolvedValueOnce(slackResponse({ messages: [parent] }))
      .mockResolvedValueOnce(slackResponse({ messages: [] }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C0PR123',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({
      eventId: 'github-pr:276:complete:merged:2026-08-23T03:00:00.000Z',
      eventType: 'turn_completed',
      sessionId: 'github-pr-276',
      operator: 'masato',
      prNumber: 276,
      syncMode: 'reconcile',
      eventSource: 'github',
      content: 'PR #276をマージし、対応が完了しました。',
    }), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every((call) => !String(call[0]).includes('chat.postMessage'))).toBe(true);
  });

  test('親スレッドが無い場合は作ってから返信する', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.001' }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_IDEA_CHANNEL_ID: 'C-IDEA',
    }, event({ content: 'アイデアを正本化して' }), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
    const parent = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const reply = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    expect(parent.channel).toBe('C-IDEA');
    expect(parent.metadata.event_payload.work_key).toBe('session:session-1');
    expect(reply.thread_ts).toBe('200.001');
  });

  test('対応開始時に要対応チャンネルへTASK-ID付きで起票する', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.001' }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ permalink: 'https://slack.example/source' }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({ prNumber: 220 }), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(6);
    const task = JSON.parse(String(fetcher.mock.calls[5]?.[1]?.body));
    expect(task.channel).toBe('C-TASK');
    expect(task.metadata.event_payload).toMatchObject({
      work_key: 'pr:220',
      task_id: taskIdForKey('pr:220'),
      source_channel: 'C-PR',
      source_thread_ts: '200.001',
    });
    expect(JSON.stringify(task.blocks)).toContain(taskIdForKey('pr:220'));
    const actionsBlock = task.blocks.find((block: { type?: string }) => block.type === 'actions');
    const actionIds = actionsBlock.elements.map((item: { action_id: string }) => item.action_id);
    expect(new Set(actionIds).size).toBe(3);
    expect(actionIds).toEqual([
      `${TASK_ACTION_ID}_working`,
      `${TASK_ACTION_ID}_review`,
      `${TASK_ACTION_ID}_done`,
    ]);
  });

  test('Codex報告のたびに指令塔の開発指令盤を1件だけ作成・更新する', async () => {
    const taskMessage = {
      ts: '300.001',
      text: '【要対応】\n状態：:large_blue_circle: 作業中\n担当：ケンタ',
      metadata: {
        event_type: 'line_harness_task',
        event_payload: {
          work_key: 'pr:254',
          task_id: taskIdForKey('pr:254'),
          source_channel: 'C-PR',
          source_thread_ts: '200.001',
          session_id: 'session-1',
          status: 'working',
          operator: 'kenta',
          title: 'Slack指令盤を作成中',
          environment: 'development',
          pr_number: '254',
        },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.001' }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ permalink: 'https://slack.example/source' }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }))
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ ts: '400.001' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
      SLACK_COMMAND_CHANNEL_ID: 'C-COMMAND',
    }, event({
      prNumber: 254,
      openPrs: [{
        number: 254,
        title: 'Slack指令盤',
        url: 'https://github.com/example/repo/pull/254',
        author: 'skmtmst',
        headRefName: 'codex/kenta-slack-command-center',
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        updatedAt: '2026-08-22T01:00:00Z',
        fileCount: 4,
        overlapsWith: [],
        checks: 'pass',
      }],
    }), fetcher);

    const boardRequest = JSON.parse(String(fetcher.mock.calls[8]?.[1]?.body));
    expect(String(fetcher.mock.calls[8]?.[0])).toContain('chat.postMessage');
    expect(boardRequest.channel).toBe('C-COMMAND');
    expect(boardRequest.metadata.event_type).toBe('line_harness_command_center');
    expect(boardRequest.text).toContain('#254> ケンタ｜統合可能');
    expect(boardRequest.text).toContain(taskIdForKey('pr:254'));
  });

  test('GitHubの指令塔専用イベントはPRスレッドを作らず現在時刻で更新する', async () => {
    const existingBoard = {
      ts: '400.001',
      text: '*【LINE Harness 開発指令盤】*\n更新：古い時刻',
      metadata: {
        event_type: 'line_harness_command_center',
        event_payload: { version: '1' },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ messages: [existingBoard] }))
      .mockResolvedValueOnce(slackResponse({ ts: existingBoard.ts }));

    const result = await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
      SLACK_COMMAND_CHANNEL_ID: 'C-COMMAND',
    }, event({
      eventId: 'github-command-center:2026-08-23T14:30:00.000Z',
      eventSource: 'github',
      syncMode: 'reconcile',
      commandCenterOnly: true,
      refreshCommandCenter: true,
      occurredAt: '2026-08-23T14:30:00.000Z',
      openPrs: [],
    }), fetcher);

    expect(result).toEqual({ category: 'fix', channelId: 'C-COMMAND', threadTs: '' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const update = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    expect(String(fetcher.mock.calls[2]?.[0])).toContain('chat.update');
    expect(update.text).toContain('08/23 23:30 JST');
    expect(update.text).toContain('未完了PR 0');
  });

  test('元スレッドのリンク取得に失敗しても要対応タスクを起票する', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ ts: '1787334034.300149' }))
      .mockResolvedValueOnce(slackResponse({ ts: '1787334034.300150' }))
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ ok: false, error: 'invalid_arguments' }))
      .mockResolvedValueOnce(slackResponse({ ts: '1787334034.300151' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({ prNumber: 220 }), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(6);
    const task = JSON.parse(String(fetcher.mock.calls[5]?.[1]?.body));
    expect(task.channel).toBe('C-TASK');
    expect(JSON.stringify(task.blocks)).toContain(
      'https://slack.com/archives/C-PR/p1787334034300149',
    );
  });

  test('Codexが完了を報告すると要対応一覧から削除する', async () => {
    const taskMessage = {
      ts: '300.001',
      metadata: {
        event_type: 'line_harness_task',
        event_payload: {
          work_key: 'pr:220',
          source_channel: 'C0PR123',
          source_thread_ts: '1787334034.300149',
        },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({ prNumber: 220, eventType: 'turn_completed', content: 'PR #220の修正が完了しました' }), fetcher);

    const deletion = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    expect(String(fetcher.mock.calls[2]?.[0])).toContain('chat.delete');
    expect(deletion).toEqual({ channel: 'C-TASK', ts: '300.001' });
  });

  test('同じCodexチャットなら分類が変わった完了報告も元タスクを閉じる', async () => {
    const taskMessage = {
      ts: '300.001',
      metadata: {
        event_type: 'line_harness_task',
        event_payload: {
          work_key: 'session:session-1',
          source_channel: 'C0PR123',
          source_thread_ts: '1787334034.300149',
        },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_COMMAND_CHANNEL_ID: 'C-COMMAND',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({
      eventType: 'turn_completed',
      content: 'Slack接続確認タスクが完了しました',
      refreshCommandCenter: false,
    }), fetcher);

    const reply = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const deletion = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    expect(reply).toMatchObject({ channel: 'C0PR123', thread_ts: '1787334034.300149' });
    expect(deletion).toEqual({ channel: 'C-TASK', ts: '300.001' });
  });

  test('新しいCodexチャットでもTASK-IDから元スレッドへ引き継ぐ', async () => {
    const originalKey = 'error:session:original';
    const taskId = taskIdForKey(originalKey);
    const taskMessage = {
      ts: '300.001',
      text: '【要対応】\n状態：:eyes: 確認待ち',
      blocks: [],
      metadata: {
        event_type: 'line_harness_task',
        event_payload: {
          work_key: originalKey,
          task_id: taskId,
          source_channel: 'C0ERROR123',
          source_thread_ts: '1787326497.583159',
        },
      },
    };
    const errorParent = {
      ts: '1787326497.583159',
      text: '*【:warning: エラー報告】API 500*\n担当：Codex\n状態：:eyes: 確認待ち\n\n以降の確認・会話・Codexへの依頼は、このスレッドへ返信してください。',
      metadata: {
        event_type: 'line_harness_codex',
        event_payload: { work_key: originalKey, category: 'error' },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ messages: [errorParent] }))
      .mockResolvedValueOnce(slackResponse({ ts: errorParent.ts }))
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    const result = await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_ERROR_CHANNEL_ID: 'C0ERROR123',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({ content: `${taskId} このエラーを修正して` }), fetcher);

    expect(result).toMatchObject({ channelId: 'C0ERROR123', threadTs: '1787326497.583159' });
    const reply = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const parentUpdate = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
    const taskUpdate = JSON.parse(String(fetcher.mock.calls[5]?.[1]?.body));
    expect(reply).toMatchObject({ channel: 'C0ERROR123', thread_ts: '1787326497.583159' });
    expect(parentUpdate.text).toContain('状態：:large_blue_circle: 作業中');
    expect(taskUpdate.metadata.event_payload).toMatchObject({
      work_key: originalKey,
      task_id: taskId,
      session_id: 'session-1',
    });
  });

  test('PR番号が後から付いてもCodexセッションから元エラータスクを完了する', async () => {
    const errorParent = {
      ts: '1787326497.583159',
      text: '*【:warning: エラー報告】API 500*\n担当：Codex\n状態：:large_blue_circle: 作業中\n\n以降の確認・会話・Codexへの依頼は、このスレッドへ返信してください。',
      metadata: {
        event_type: 'line_harness_codex',
        event_payload: { work_key: 'session:runtime-error', category: 'error' },
      },
    };
    const taskMessage = {
      ts: '300.001',
      metadata: {
        event_type: 'line_harness_task',
        event_payload: {
          work_key: 'session:runtime-error',
          task_id: 'TASK-0123456789ABCDEF',
          source_channel: 'C0ERROR123',
          source_thread_ts: '1787326497.583159',
          session_id: 'session-1',
        },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ messages: [errorParent] }))
      .mockResolvedValueOnce(slackResponse({ ts: errorParent.ts }))
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    const result = await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_ERROR_CHANNEL_ID: 'C0ERROR123',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({
      eventType: 'turn_completed',
      prNumber: 249,
      prUrl: 'https://github.com/skmtmst/line-harness-oss/pull/249',
      content: 'PR #249の修正と検証環境への反映が完了しました',
    }), fetcher);

    expect(result).toMatchObject({ channelId: 'C0ERROR123', threadTs: '1787326497.583159' });
    const reply = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const parentUpdate = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
    const deletion = JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body));
    expect(reply).toMatchObject({ channel: 'C0ERROR123', thread_ts: '1787326497.583159' });
    expect(reply.text).toContain('PR #249');
    expect(parentUpdate.text).toContain('状態：:white_check_mark: 完了');
    expect(deletion).toEqual({ channel: 'C-TASK', ts: '300.001' });
  });

  test('本文にエラーがあってもPR番号があればPRチャンネルで同じタスクとして扱う', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({
        messages: [{ ts: '1787326497.583159', metadata: { event_type: 'line_harness_codex', event_payload: { work_key: 'pr:220' } } }],
      }))
      .mockResolvedValueOnce(slackResponse({ ts: '1787326497.583160' }))
      .mockResolvedValueOnce(slackResponse({
        messages: [{ ts: '1787326497.583161', metadata: { event_type: 'line_harness_task', event_payload: { work_key: 'pr:220' } } }],
      }))
      .mockResolvedValueOnce(slackResponse({ ts: '1787326497.583161' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_ERROR_CHANNEL_ID: 'C0ERROR123',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C0PR123',
      SLACK_TASK_CHANNEL_ID: 'C0TASK123',
    }, event({ prNumber: 220, content: 'PR #220でエラーが出ました' }), fetcher);

    const reply = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(reply).toMatchObject({ channel: 'C0PR123', thread_ts: '1787326497.583159' });
  });

  test('Slackの完了ボタンは元スレッドへ記録して要対応メッセージを消す', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));
    const result = await handleSlackTaskAction({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
      SLACK_KENTA_USER_ID: 'U-KENTA',
    }, {
      user: { id: 'U-KENTA' },
      channel: { id: 'C-TASK' },
      message: { ts: '300.001', text: '【要対応】' },
      actions: [{
        action_id: TASK_ACTION_ID,
        value: JSON.stringify({
          status: 'done',
          key: 'pr:220',
          sourceChannel: 'C0SOURCE123',
          sourceThreadTs: '1787326000.000001',
        }),
      }],
    }, fetcher);

    expect(result).toEqual({ status: 'done' });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('chat.postMessage');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('chat.delete');
  });

  test('エラーの完了ボタンは親投稿を完了表示にしてから要対応だけを消す', async () => {
    const errorParent = {
      ts: '1787326000.000001',
      text: '*【:warning: エラー報告】API 500*\n担当：Codex\n状態：:eyes: 確認待ち\n\n以降の確認・会話・Codexへの依頼は、このスレッドへ返信してください。',
      metadata: {
        event_type: 'line_harness_codex',
        event_payload: { work_key: 'session:runtime-error', category: 'error' },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [errorParent] }))
      .mockResolvedValueOnce(slackResponse({ ts: errorParent.ts }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    const result = await handleSlackTaskAction({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_ERROR_CHANNEL_ID: 'C0ERROR123',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
      SLACK_KENTA_USER_ID: 'U-KENTA',
    }, {
      user: { id: 'U-KENTA' },
      channel: { id: 'C-TASK' },
      message: { ts: '300.001', text: '【要対応】' },
      actions: [{
        action_id: TASK_ACTION_ID,
        value: JSON.stringify({
          status: 'done',
          key: 'session:runtime-error',
          sourceChannel: 'C0ERROR123',
          sourceThreadTs: errorParent.ts,
        }),
      }],
    }, fetcher);

    expect(result).toEqual({ status: 'done' });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('conversations.history');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      channel: 'C0ERROR123',
      oldest: errorParent.ts,
      latest: errorParent.ts,
      inclusive: true,
      limit: 1,
      include_all_metadata: true,
    });
    const parentUpdate = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(parentUpdate).toMatchObject({ channel: 'C0ERROR123', ts: errorParent.ts });
    expect(parentUpdate.text).toContain('状態：:white_check_mark: 完了');
    expect(String(fetcher.mock.calls[2]?.[0])).toContain('chat.postMessage');
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('chat.delete');
  });

  test('LINE Harnessの実行時エラーをエラー報告と要対応へ自動起票する', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ ts: '1787327000.000001' }))
      .mockResolvedValueOnce(slackResponse({ ts: '1787327000.000002' }))
      .mockResolvedValueOnce(slackResponse({ messages: [] }))
      .mockResolvedValueOnce(slackResponse({ permalink: 'https://slack.example/error' }))
      .mockResolvedValueOnce(slackResponse({ ts: '1787327000.000003' }));

    const reported = await reportHarnessErrorToSlack({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_ERROR_CHANNEL_ID: 'C-ERROR',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, {
      source: 'worker',
      message: 'Database unavailable',
      path: 'GET /api/friends',
      stack: 'Error: Database unavailable\n at handler',
    }, fetcher);

    expect(reported).toBe(true);
    const errorParent = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    const task = JSON.parse(String(fetcher.mock.calls[6]?.[1]?.body));
    expect(errorParent.channel).toBe('C-ERROR');
    expect(task.channel).toBe('C-TASK');
    expect(task.text).toContain('LINE Harnessがエラーを自動検知');
    expect(errorParent.text).toContain('TASK-ID');
    expect(errorParent.text).toContain('状態：:eyes: 確認待ち');
  });
});
