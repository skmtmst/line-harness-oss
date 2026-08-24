import { describe, expect, test, vi } from 'vitest';
import {
  operatorForPull,
  isPullExcluded,
  relayPayloadForPull,
  summarizeChecks,
  syncGitHubPullRequests,
  type GitHubPullRequest,
  type RelayPayload,
} from './github-slack-pr-sync.ts';

function pull(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 276,
    title: 'GitHubからSlackへ同期する',
    html_url: 'https://github.com/skmtmst/line-harness-oss/pull/276',
    state: 'open',
    draft: false,
    merged: false,
    merged_at: null,
    updated_at: '2026-08-23T02:00:00.000Z',
    user: { login: 'skmtmst' },
    head: { ref: 'codex/masato-github-slack-pr-sync', sha: 'abc123' },
    base: { ref: 'codex/development' },
    mergeable_state: 'clean',
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHub PR Slack sync', () => {
  test('GitHubのチェック状態と担当者をSlack用に正規化する', () => {
    expect(summarizeChecks([])).toBe('none');
    expect(summarizeChecks([{ status: 'in_progress', conclusion: null }])).toBe('pending');
    expect(summarizeChecks([{ status: 'completed', conclusion: 'success' }])).toBe('pass');
    expect(summarizeChecks([{ status: 'completed', conclusion: 'failure' }])).toBe('fail');
    expect(operatorForPull(pull())).toBe('masato');
    expect(operatorForPull(pull({ user: { login: 'kentavndng' } }))).toBe('kenta');
  });

  test('通常イベントと再照合を区別し、マージを完了イベントにする', () => {
    const opened = relayPayloadForPull('skmtmst/line-harness-oss', pull(), 'opened', 'event', []);
    const merged = relayPayloadForPull('skmtmst/line-harness-oss', pull({
      state: 'closed',
      merged: true,
      merged_at: '2026-08-23T03:00:00.000Z',
    }), 'reconcile', 'reconcile', []);

    expect(opened).toMatchObject({
      eventType: 'prompt_submitted',
      eventSource: 'github',
      syncMode: 'event',
      refreshCommandCenter: true,
      prNumber: 276,
    });
    expect(opened.content).toContain('作成しました');
    expect(merged.eventType).toBe('turn_completed');
    expect(merged.syncMode).toBe('reconcile');
    expect(merged.content).toContain('マージし、対応が完了しました');
    expect(merged.eventId).toBe('github-pr:276:complete:merged:2026-08-23T03:00:00.000Z');
    expect(relayPayloadForPull('skmtmst/line-harness-oss', pull({
      state: 'closed',
      merged: true,
      merged_at: '2026-08-23T03:00:00.000Z',
    }), 'closed', 'event', []).eventId).toBe(merged.eventId);
  });

  test('除外ラベル付きPRをSlack同期対象から外す', () => {
    expect(isPullExcluded(pull({ labels: [{ name: 'slack-sync-ignore' }] }), ['slack-sync-ignore'])).toBe(true);
    expect(isPullExcluded(pull({ labels: [{ name: 'backend' }] }), ['slack-sync-ignore'])).toBe(false);
  });

  test('PRイベントを送り、その後に未通知のopen/closedを再照合する', async () => {
    const open = pull();
    const merged = pull({
      number: 277,
      html_url: 'https://github.com/skmtmst/line-harness-oss/pull/277',
      state: 'closed',
      merged: true,
      merged_at: '2026-08-23T03:00:00.000Z',
      updated_at: '2026-08-23T03:00:00.000Z',
      head: { ref: 'codex/kenta-followup', sha: 'def456' },
      user: { login: 'kentavndng' },
    });
    const relayed: RelayPayload[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('api.github.com') && url.includes('/pulls?state=open')) return jsonResponse([open]);
      if (url.endsWith('/pulls/276')) return jsonResponse(open);
      if (url.includes('/pulls/276/files')) return jsonResponse([{ filename: 'apps/worker/src/index.ts' }]);
      if (url.includes('/commits/abc123/check-runs')) {
        return jsonResponse({ check_runs: [{ status: 'completed', conclusion: 'success' }] });
      }
      if (url.includes('api.github.com') && url.includes('/pulls?state=closed')) return jsonResponse([merged]);
      if (url === 'https://relay.example.test/events') {
        relayed.push(JSON.parse(String(init?.body)) as RelayPayload);
        return jsonResponse({ success: true });
      }
      return new Response(null, { status: 404 });
    });

    const result = await syncGitHubPullRequests({
      repository: 'skmtmst/line-harness-oss',
      githubToken: 'github-test-token',
      relayUrl: 'https://relay.example.test/events',
      relaySecret: 'relay-test-secret',
      eventName: 'pull_request',
      event: { action: 'opened', pull_request: open },
      minPrNumber: 276,
      closedLookbackHours: 72,
      dedicatedCommandCenter: true,
      now: new Date('2026-08-23T04:00:00.000Z'),
      fetcher,
    });

    expect(result).toEqual({ sent: 1, reconciled: 2 });
    expect(relayed.map((item) => [item.prNumber, item.syncMode])).toEqual([
      [276, 'event'],
      [276, 'reconcile'],
      [277, 'reconcile'],
      [undefined, 'reconcile'],
    ]);
    expect(relayed.map((item) => item.refreshCommandCenter)).toEqual([false, false, false, true]);
    expect(relayed.at(-1)).toMatchObject({
      commandCenterOnly: true,
      occurredAt: '2026-08-23T04:00:00.000Z',
    });
    expect(relayed[0]?.openPrs[0]).toMatchObject({
      number: 276,
      fileCount: 1,
      checks: 'pass',
      mergeStateStatus: 'CLEAN',
    });
    expect(JSON.stringify(relayed)).not.toContain('github-test-token');
    expect(JSON.stringify(relayed)).not.toContain('relay-test-secret');

    relayed.length = 0;
    const singleResult = await syncGitHubPullRequests({
      repository: 'skmtmst/line-harness-oss',
      githubToken: 'github-test-token',
      relayUrl: 'https://relay.example.test/events',
      relaySecret: 'relay-test-secret',
      eventName: 'workflow_dispatch',
      minPrNumber: 276,
      onlyPrNumber: 276,
      closedLookbackHours: 72,
      now: new Date('2026-08-23T04:00:00.000Z'),
      fetcher,
    });

    expect(singleResult).toEqual({ sent: 0, reconciled: 1 });
    expect(relayed.map((item) => [item.prNumber, item.syncMode])).toEqual([[276, 'reconcile']]);
    expect(relayed[0]).toMatchObject({
      refreshCommandCenter: true,
      occurredAt: '2026-08-23T04:00:00.000Z',
    });
    expect(relayed[0]?.commandCenterOnly).toBeUndefined();
  });

  test('即時通知が失敗しても全PRと指令塔の再照合を続けて失敗を表に出す', async () => {
    const first = pull();
    const second = pull({
      number: 277,
      html_url: 'https://github.com/skmtmst/line-harness-oss/pull/277',
      head: { ref: 'codex/kenta-followup', sha: 'def456' },
      user: { login: 'kentavndng' },
    });
    const relayed: RelayPayload[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('api.github.com') && url.includes('/pulls?state=open')) return jsonResponse([first, second]);
      if (url.includes('api.github.com') && url.includes('/pulls?state=closed')) return jsonResponse([]);
      if (url.includes('/pulls/') && !url.includes('/files')) {
        return jsonResponse(url.endsWith('/277') ? second : first);
      }
      if (url.includes('/files')) return jsonResponse([]);
      if (url.includes('/check-runs')) return jsonResponse({ check_runs: [] });
      if (url === 'https://relay.example.test/events') {
        const payload = JSON.parse(String(init?.body)) as RelayPayload;
        if (payload.syncMode === 'event') return new Response(null, { status: 400 });
        relayed.push(payload);
        return jsonResponse({ success: true });
      }
      return new Response(null, { status: 404 });
    });

    await expect(syncGitHubPullRequests({
      repository: 'skmtmst/line-harness-oss',
      githubToken: 'github-test-token',
      relayUrl: 'https://relay.example.test/events',
      relaySecret: 'relay-test-secret',
      eventName: 'pull_request',
      event: { action: 'opened', pull_request: first },
      minPrNumber: 276,
      closedLookbackHours: 72,
      dedicatedCommandCenter: true,
      now: new Date('2026-08-23T04:00:00.000Z'),
      fetcher,
    })).rejects.toThrow('SLACK_SYNC_PARTIAL_FAILURE:event:PR#276:SLACK_RELAY_FAILED:400');

    expect(relayed.map((item) => [item.prNumber, item.commandCenterOnly])).toEqual([
      [276, undefined],
      [277, undefined],
      [undefined, true],
    ]);
  });

  test('1件の再照合が失敗しても後続PRと指令塔を更新する', async () => {
    const first = pull();
    const second = pull({
      number: 277,
      html_url: 'https://github.com/skmtmst/line-harness-oss/pull/277',
      head: { ref: 'codex/kenta-followup', sha: 'def456' },
    });
    const relayed: RelayPayload[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('api.github.com') && url.includes('/pulls?state=open')) return jsonResponse([first, second]);
      if (url.includes('api.github.com') && url.includes('/pulls?state=closed')) return jsonResponse([]);
      if (url.includes('/pulls/') && !url.includes('/files')) {
        return jsonResponse(url.endsWith('/277') ? second : first);
      }
      if (url.includes('/files')) return jsonResponse([]);
      if (url.includes('/check-runs')) return jsonResponse({ check_runs: [] });
      if (url === 'https://relay.example.test/events') {
        const payload = JSON.parse(String(init?.body)) as RelayPayload;
        if (payload.prNumber === 276) return new Response(null, { status: 400 });
        relayed.push(payload);
        return jsonResponse({ success: true });
      }
      return new Response(null, { status: 404 });
    });

    await expect(syncGitHubPullRequests({
      repository: 'skmtmst/line-harness-oss',
      githubToken: 'github-test-token',
      relayUrl: 'https://relay.example.test/events',
      relaySecret: 'relay-test-secret',
      eventName: 'schedule',
      minPrNumber: 276,
      closedLookbackHours: 72,
      dedicatedCommandCenter: true,
      now: new Date('2026-08-23T04:00:00.000Z'),
      fetcher,
    })).rejects.toThrow('SLACK_SYNC_PARTIAL_FAILURE:reconcile:PR#276:SLACK_RELAY_FAILED:400');

    expect(relayed.map((item) => [item.prNumber, item.commandCenterOnly])).toEqual([
      [277, undefined],
      [undefined, true],
    ]);
  });

  test('Relayが500を返しても同じSlack通知を再送しない', async () => {
    const open = pull();
    let relayAttempts = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('api.github.com') && url.includes('/pulls?state=open')) return jsonResponse([open]);
      if (url.includes('api.github.com') && url.includes('/pulls?state=closed')) return jsonResponse([]);
      if (url.endsWith('/pulls/276')) return jsonResponse(open);
      if (url.includes('/pulls/276/files')) return jsonResponse([]);
      if (url.includes('/commits/abc123/check-runs')) return jsonResponse({ check_runs: [] });
      if (url === 'https://relay.example.test/events') {
        relayAttempts += 1;
        return new Response(null, { status: 500 });
      }
      return new Response(null, { status: 404 });
    });

    await expect(syncGitHubPullRequests({
      repository: 'skmtmst/line-harness-oss',
      githubToken: 'github-test-token',
      relayUrl: 'https://relay.example.test/events',
      relaySecret: 'relay-test-secret',
      eventName: 'workflow_dispatch',
      minPrNumber: 276,
      onlyPrNumber: 276,
      closedLookbackHours: 72,
      now: new Date('2026-08-23T04:00:00.000Z'),
      fetcher,
    })).rejects.toThrow('SLACK_SYNC_PARTIAL_FAILURE:reconcile:PR#276:SLACK_RELAY_FAILED:500');

    expect(relayAttempts).toBe(1);
  });
});
