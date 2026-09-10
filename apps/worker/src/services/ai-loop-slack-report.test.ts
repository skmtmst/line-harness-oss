import { describe, expect, test, vi } from 'vitest';
import { relayAiLoopReport, type AiLoopReport } from './ai-loop-slack-report.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

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

function runtime() {
  const store = createTestD1();
  return {
    store,
    config: { DB: store.db, SLACK_BOT_TOKEN: 'xoxb-test', SLACK_AI_LOOP_CHANNEL_ID: 'C-AI-LOOP' },
  };
}

describe('AI loop Slack report relay', () => {
  test('creates one report-only message in the dedicated channel', async () => {
    const { config, store } = runtime();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ok: true, ts: '100.200' }));
    const result = await relayAiLoopReport(config, report, fetcher);

    expect(result).toEqual({ action: 'created', ts: '100.200' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, request] = fetcher.mock.calls[0] as [string, RequestInit];
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
    expect(store.raw.prepare('SELECT slack_ts, claim_token FROM ai_loop_slack_reports').get()).toEqual({
      slack_ts: '100.200', claim_token: null,
    });
  });

  test('updates the same task instead of creating duplicate messages', async () => {
    const { config, store } = runtime();
    store.raw.prepare(`INSERT INTO ai_loop_slack_reports
      (work_key, slack_ts, revision, claim_token, claim_expires_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?)`).run('ai-loop:skmtmst/nen-petfood-eccube:LOOP-143', '100.200', report.revision, Date.now());
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ok: true, ts: '100.200' }));
    const result = await relayAiLoopReport(config, { ...report, status: 'completed', revision: 1_788_927_600_001 }, fetcher);

    expect(result.action).toBe('updated');
    expect(String(fetcher.mock.calls[0][0]).endsWith('/chat.update')).toBe(true);
    expect(JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      channel: 'C-AI-LOOP',
      ts: '100.200',
    });
  });

  test('ignores stale or duplicate revisions', async () => {
    const { config, store } = runtime();
    store.raw.prepare(`INSERT INTO ai_loop_slack_reports
      (work_key, slack_ts, revision, claim_token, claim_expires_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?)`).run('ai-loop:skmtmst/nen-petfood-eccube:LOOP-143', '100.200', report.revision, Date.now());
    const fetcher = vi.fn();
    const result = await relayAiLoopReport(config, { ...report, revision: 1_788_927_599_999 }, fetcher);
    expect(result).toEqual({ action: 'ignored', ts: '100.200' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('surfaces Slack API failures without leaking report contents', async () => {
    const { config } = runtime();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'not_in_channel' })));
    await expect(relayAiLoopReport(config, report, fetcher)).rejects.toThrow('SLACK_API_FAILED:chat.postMessage:not_in_channel');
  });

  test('escapes Slack mentions and links in untrusted report text', async () => {
    const { config } = runtime();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ok: true, ts: '100.200' }));
    await relayAiLoopReport(config, { ...report, title: '<!channel>', summary: '<@U123> & <https://evil.example>' }, fetcher);
    const body = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)) as { text: string };
    expect(body.text).toContain('&lt;!channel&gt;');
    expect(body.text).toContain('&lt;@U123&gt; &amp; &lt;https://evil.example&gt;');
    expect(body.text).not.toContain('<!channel>');
  });

  test('a concurrent duplicate can create only one Slack message', async () => {
    const { config } = runtime();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => { await gate; return json({ ok: true, ts: '100.200' }); });
    const first = relayAiLoopReport(config, report, fetcher);
    await Promise.resolve();
    const second = relayAiLoopReport(config, report, fetcher);
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((item) => item.action).sort()).toEqual(['created', 'ignored']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('a newer revision arriving during an active claim is retryable, never silently ignored', async () => {
    const { config } = runtime();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => { await gate; return json({ ok: true, ts: '100.200' }); });
    const first = relayAiLoopReport(config, report, fetcher);
    await Promise.resolve();
    await expect(relayAiLoopReport(config, { ...report, status: 'completed', revision: report.revision + 1 }, fetcher))
      .rejects.toThrow('AI_LOOP_SLACK_REPORT_BUSY');
    release();
    await expect(first).resolves.toMatchObject({ action: 'created' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('an expired unfinished create recovers the Slack ts before updating', async () => {
    const { config, store } = runtime();
    store.raw.prepare(`INSERT INTO ai_loop_slack_reports
      (work_key, slack_ts, revision, claim_token, claim_expires_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, ?)`).run(
      'ai-loop:skmtmst/nen-petfood-eccube:LOOP-143', report.revision, 'expired-claim', 1, 1,
    );
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        ok: true,
        messages: [{
          ts: '100.200',
          metadata: { event_type: 'nen_ai_loop_report', event_payload: {
            work_key: 'ai-loop:skmtmst/nen-petfood-eccube:LOOP-143', revision: String(report.revision),
          } },
        }],
      }))
      .mockResolvedValueOnce(json({ ok: true, ts: '100.200' }));
    await expect(relayAiLoopReport(config, report, fetcher)).resolves.toEqual({ action: 'updated', ts: '100.200' });
    expect(String(fetcher.mock.calls[0][0])).toMatch(/conversations\.history$/);
    expect(String(fetcher.mock.calls[1][0])).toMatch(/chat\.update$/);
  });
});
