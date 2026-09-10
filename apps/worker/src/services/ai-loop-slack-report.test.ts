import { describe, expect, test, vi } from 'vitest';
import { relayAiLoopReport, type AiLoopReport } from './ai-loop-slack-report.js';

const report: AiLoopReport = {
  version: 1,
  eventId: 'LOOP-143:started',
  taskId: 'LOOP-143',
  repository: 'skmtmst/nen-petfood-eccube',
  title: 'Slack報告専用経路を接続する',
  commander: 'codex',
  executor: 'meta',
  model: 'Muse Spark 1.3 Contributor',
  status: 'started',
  summary: '報告専用の接続テストを開始しました。',
  taskUrl: 'https://github.com/skmtmst/nen-petfood-eccube/issues/143',
  occurredAt: '2026-09-09T04:00:00.000Z',
  revision: 1_788_927_600_000,
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('AI loop Slack report relay', () => {
  test('creates one report-only message in the dedicated channel', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, messages: [] }))
      .mockResolvedValueOnce(json({ ok: true, ts: '100.200' }));
    const result = await relayAiLoopReport({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_AI_LOOP_CHANNEL_ID: 'C-AI-LOOP',
    }, report, fetcher);

    expect(result).toEqual({ action: 'created', ts: '100.200' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, request] = fetcher.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.channel).toBe('C-AI-LOOP');
    expect(body.client_msg_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(body).not.toHaveProperty('blocks');
    expect(body).not.toHaveProperty('attachments');
    expect(String(body.text)).not.toMatch(/承認する|差し戻す|実行する/);
    expect(body.metadata).toMatchObject({
      event_type: 'nen_ai_loop_report',
      event_payload: { work_key: 'ai-loop:skmtmst/nen-petfood-eccube:LOOP-143', revision: '1788927600000' },
    });
  });

  test('updates the same task instead of creating duplicate messages', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        ok: true,
        messages: [{
          ts: '100.200',
          metadata: {
            event_type: 'nen_ai_loop_report',
            event_payload: { work_key: 'ai-loop:skmtmst/nen-petfood-eccube:LOOP-143', revision: '1788927600000' },
          },
        }],
      }))
      .mockResolvedValueOnce(json({ ok: true, ts: '100.200' }));
    const result = await relayAiLoopReport({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_AI_LOOP_CHANNEL_ID: 'C-AI-LOOP',
    }, { ...report, status: 'completed', revision: 1_788_927_600_001 }, fetcher);

    expect(result.action).toBe('updated');
    expect(String(fetcher.mock.calls[1][0]).endsWith('/chat.update')).toBe(true);
    expect(JSON.parse(String((fetcher.mock.calls[1][1] as RequestInit).body))).toMatchObject({
      channel: 'C-AI-LOOP',
      ts: '100.200',
    });
  });

  test('ignores stale or duplicate revisions', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({
      ok: true,
      messages: [{
        ts: '100.200',
        metadata: {
          event_type: 'nen_ai_loop_report',
          event_payload: { work_key: 'ai-loop:skmtmst/nen-petfood-eccube:LOOP-143', revision: '1788927600000' },
        },
      }],
    }));
    const result = await relayAiLoopReport({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_AI_LOOP_CHANNEL_ID: 'C-AI-LOOP',
    }, { ...report, revision: 1_788_927_599_999 }, fetcher);
    expect(result).toEqual({ action: 'ignored', ts: '100.200' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('surfaces Slack API failures without leaking report contents', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'not_in_channel' })));
    await expect(relayAiLoopReport({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_AI_LOOP_CHANNEL_ID: 'C-AI-LOOP',
    }, report, fetcher)).rejects.toThrow('SLACK_API_FAILED:conversations.history:not_in_channel');
  });
});
