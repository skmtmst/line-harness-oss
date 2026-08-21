import { describe, expect, test, vi } from 'vitest';
import {
  classifyCodexSlackEvent,
  prRangeKey,
  relayCodexSlackEvent,
  resolveCodexSlackChannel,
  sanitizeSlackContent,
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
    expect(parent.metadata.event_payload.work_key).toBe('idea:session:session-1');
    expect(reply.thread_ts).toBe('200.001');
  });
});
