import { describe, expect, test, vi } from 'vitest';
import {
  classifyCodexSlackEvent,
  handleSlackTaskAction,
  harnessErrorIncidentKey,
  isCodexTaskCompletion,
  prRangeKey,
  reportHarnessErrorToSlack,
  relayCodexSlackEvent,
  resolveCodexSlackChannel,
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
    expect(resolveCodexSlackChannel({
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-DEFAULT',
      SLACK_PR_CHANNELS_JSON: JSON.stringify({ '201-300': 'C-201-300' }),
    }, 'fix', 220)).toBe('C-201-300');
  });

  test('Slackに出す前に秘密値を隠す', () => {
    const content = sanitizeSlackContent('token=xoxb-123456789012-abcdefghijkl password=hunter2');
    expect(content).not.toContain('xoxb-123456789012-abcdefghijkl');
    expect(content).not.toContain('hunter2');
    expect(content).toContain('[REDACTED]');
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
  });

  test('同じ作業キーから同じTASK-IDを生成する', () => {
    expect(taskIdForKey('pr:220')).toMatch(/^TASK-[0-9A-F]{16}$/);
    expect(taskIdForKey('pr:220')).toBe(taskIdForKey('pr:220'));
    expect(taskIdForKey('pr:220')).not.toBe(taskIdForKey('pr:221'));
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
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({ prNumber: 220, eventType: 'turn_completed', content: 'PR #220の修正が完了しました' }), fetcher);

    const deletion = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('chat.delete');
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
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_COMMAND_CHANNEL_ID: 'C-COMMAND',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({
      eventType: 'turn_completed',
      content: 'Slack接続確認タスクが完了しました',
    }), fetcher);

    const reply = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const deletion = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
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
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '200.002' }))
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    const result = await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_ERROR_CHANNEL_ID: 'C0ERROR123',
      SLACK_TASK_CHANNEL_ID: 'C-TASK',
    }, event({ content: `${taskId} このエラーを修正して` }), fetcher);

    expect(result).toMatchObject({ channelId: 'C0ERROR123', threadTs: '1787326497.583159' });
    const reply = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const taskUpdate = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
    expect(reply).toMatchObject({ channel: 'C0ERROR123', thread_ts: '1787326497.583159' });
    expect(taskUpdate.metadata.event_payload).toMatchObject({
      work_key: originalKey,
      task_id: taskId,
      session_id: 'session-1',
    });
  });

  test('PR番号が後から付いてもCodexセッションから元エラータスクを完了する', async () => {
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
      .mockResolvedValueOnce(slackResponse({ messages: [taskMessage] }))
      .mockResolvedValueOnce(slackResponse({ ts: '300.001' }));

    const result = await relayCodexSlackEvent({
      SLACK_BOT_TOKEN: 'xoxb-test',
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
    const deletion = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
    expect(reply).toMatchObject({ channel: 'C0ERROR123', thread_ts: '1787326497.583159' });
    expect(reply.text).toContain('PR #249');
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
  });
});
