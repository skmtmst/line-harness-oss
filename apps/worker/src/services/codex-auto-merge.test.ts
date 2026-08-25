import { describe, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';
import {
  commitStatusesBlockReason,
  isCodexAutoMergeEnabled,
  parseCodexAuditApproval,
  prohibitedPullRequestChange,
  processCodexAutoMerge,
  requiredChecksBlockReason,
  type CodexAutoMergeMessage,
} from './codex-auto-merge.js';

const message: CodexAutoMergeMessage = {
  kind: 'auto_merge',
  slackEventId: 'Ev-audit-344',
  channelId: 'C-301-400',
  threadTs: '1787000000.000001',
  requesterUserId: 'U-CLAUDE',
  prNumber: 344,
};

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    SLACK_BOT_TOKEN: 'slack-bot-token',
    CODEX_AUTO_MERGE_ENABLED: 'true',
    CODEX_AUTO_MERGE_REPOSITORY: 'skmtmst/line-harness-oss',
    CODEX_AUTO_MERGE_GITHUB_TOKEN: 'github-token',
    ...overrides,
  } as Env['Bindings'];
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parentResponse(prNumber = 344): Response {
  return json({
    ok: true,
    messages: [{
      ts: message.threadTs,
      metadata: {
        event_type: 'line_harness_codex',
        event_payload: { work_key: `pr:${prNumber}` },
      },
    }],
  });
}

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 344,
    state: 'open',
    draft: false,
    merged: false,
    mergeable: true,
    mergeable_state: 'clean',
    title: 'safe change',
    html_url: 'https://github.com/skmtmst/line-harness-oss/pull/344',
    base: { ref: 'codex/development', sha: 'base-sha' },
    head: { sha: 'head-sha' },
    labels: [],
    ...overrides,
  };
}

function passedChecks() {
  return {
    check_runs: [{
      id: 10,
      name: 'required-pr-gate',
      status: 'completed',
      conclusion: 'success',
    }],
  };
}

function postedText(fetcher: ReturnType<typeof vi.fn>): string {
  const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/chat.postMessage'));
  return String(JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)).text);
}

describe('Codex監査合格合図', () => {
  test('固定された2行を含む投稿だけからPR番号を読む', () => {
    expect(parseCodexAuditApproval(
      '[claude->codex]\n確認済みです\n【監査結果】PR #344 合格・統合可',
    )).toBe(344);
    expect(parseCodexAuditApproval('前置き\n[claude->codex]\n【監査結果】PR #344 合格・統合可')).toBeNull();
    expect(parseCodexAuditApproval('[claude->codex]\n【監査結果】PR #344 条件付き合格')).toBeNull();
    expect(parseCodexAuditApproval('[claude->codex]\n【監査結果】 PR #344 合格・統合可')).toBeNull();
    expect(parseCodexAuditApproval(
      '[claude->codex]\n【監査結果】PR #344 合格・統合可\n【監査結果】PR #345 合格・統合可',
    )).toBeNull();
  });

  test('自動マージスイッチは未設定・falseなら無効', () => {
    expect(isCodexAutoMergeEnabled(undefined)).toBe(false);
    expect(isCodexAutoMergeEnabled('false')).toBe(false);
    expect(isCodexAutoMergeEnabled('true')).toBe(true);
    expect(isCodexAutoMergeEnabled('1')).toBe(true);
  });
});

describe('PR禁止差分', () => {
  test.each([
    ['packages/db/migrations/0099.sql', 'migration'],
    ['apps/worker/src/middleware/auth.ts', 'protected_file'],
    ['apps/worker/.dev.vars', 'environment_file'],
    ['apps/worker/.env.staging', 'environment_file'],
  ])('%s を拒否する', (filename, reason) => {
    expect(prohibitedPullRequestChange([{ filename }])).toMatchObject({ reason, filename });
  });

  test('wranglerへの秘密値とGitHub secret追加を拒否し、通常のfalse設定は許可する', () => {
    expect(prohibitedPullRequestChange([{
      filename: 'apps/worker/wrangler.staging.toml',
      patch: '+API_TOKEN = "actual-sensitive-value"',
    }])?.reason).toBe('secret_addition');
    expect(prohibitedPullRequestChange([{
      filename: '.github/workflows/deploy.yml',
      patch: '+          token: ${{ secrets.NEW_DEPLOY_TOKEN }}',
    }])?.reason).toBe('secret_addition');
    expect(prohibitedPullRequestChange([{
      filename: 'apps/worker/wrangler.staging.toml',
      patch: '+CODEX_AUTO_MERGE_ENABLED = "false"',
    }])).toBeNull();
  });
});

describe('必須チェック', () => {
  test('Required PR gateの欠落・未完了・失敗を拒否する', () => {
    expect(requiredChecksBlockReason([])).toContain('ありません');
    expect(requiredChecksBlockReason([{
      id: 1, name: 'required-pr-gate', status: 'in_progress', conclusion: null,
    }])).toContain('未完了');
    expect(requiredChecksBlockReason([{
      id: 2, name: 'required-pr-gate', status: 'completed', conclusion: 'failure',
    }])).toContain('失敗');
  });

  test('Slack同期は参考扱いにし、最新の必須チェックが成功なら許可する', () => {
    expect(requiredChecksBlockReason([
      { id: 1, name: 'required-pr-gate', status: 'completed', conclusion: 'failure' },
      { id: 2, name: 'required-pr-gate', status: 'completed', conclusion: 'success' },
      { id: 3, name: 'sync', status: 'completed', conclusion: 'failure' },
    ])).toBeNull();
    expect(commitStatusesBlockReason([
      { id: 1, context: 'deploy-gate', state: 'success' },
      { id: 2, context: 'sync', state: 'failure' },
    ])).toBeNull();
    expect(commitStatusesBlockReason([
      { id: 3, context: 'deploy-gate', state: 'pending' },
    ])).toContain('未完了');
  });
});

describe('Codex自動マージ処理', () => {
  test('スレッドのPR番号と合図が違えばGitHubを呼ばず理由を報告する', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(parentResponse(343))
      .mockResolvedValueOnce(json({ ok: true }));
    await processCodexAutoMerge(env(), message, fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(postedText(fetcher)).toContain('PR #343 と一致しません');
  });

  test('スイッチが未設定なら検知だけを報告しGitHubを呼ばない', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(parentResponse())
      .mockResolvedValueOnce(json({ ok: true }));
    await processCodexAutoMerge(
      env({ CODEX_AUTO_MERGE_ENABLED: undefined }),
      message,
      fetcher as typeof fetch,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(postedText(fetcher)).toContain('検知のみ');
  });

  test('台帳に記録済みなら二度目のマージをしない', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(parentResponse())
      .mockResolvedValueOnce(json(pullRequest()))
      .mockResolvedValueOnce(json([{ body: '<!-- codex-auto-merge-ledger:v1 -->\nSlack event: `another-event`' }]))
      .mockResolvedValueOnce(json({ ok: true }));
    await processCodexAutoMerge(env(), message, fetcher as typeof fetch);
    expect(fetcher.mock.calls.some(([url, init]) => (
      String(url).endsWith('/pulls/344/merge') && (init as RequestInit).method === 'PUT'
    ))).toBe(false);
    expect(postedText(fetcher)).toContain('台帳にマージ済み');
  });

  test('禁止差分は合図があってもマージせず理由を報告する', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(parentResponse())
      .mockResolvedValueOnce(json(pullRequest()))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([{ filename: 'packages/db/migrations/0099.sql' }]))
      .mockResolvedValueOnce(json({ ok: true }));
    await processCodexAutoMerge(env(), message, fetcher as typeof fetch);
    expect(postedText(fetcher)).toContain('DBマイグレーション');
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/pulls/344/merge'))).toBe(false);
  });

  test('必須チェックが未完了ならマージしない', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(parentResponse())
      .mockResolvedValueOnce(json(pullRequest()))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([{ filename: 'apps/worker/src/routes/example.ts' }]))
      .mockResolvedValueOnce(json({
        check_runs: [{
          id: 1, name: 'required-pr-gate', status: 'in_progress', conclusion: null,
        }],
      }))
      .mockResolvedValueOnce(json({ statuses: [] }))
      .mockResolvedValueOnce(json({ ok: true }));
    await processCodexAutoMerge(env(), message, fetcher as typeof fetch);
    expect(postedText(fetcher)).toContain('未完了');
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/pulls/344/merge'))).toBe(false);
  });

  test('全条件合格時だけcodex/developmentへマージし台帳へ記録する', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(parentResponse())
      .mockResolvedValueOnce(json(pullRequest()))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([{ filename: 'apps/worker/src/routes/example.ts' }]))
      .mockResolvedValueOnce(json(passedChecks()))
      .mockResolvedValueOnce(json({ statuses: [] }))
      .mockResolvedValueOnce(json(pullRequest()))
      .mockResolvedValueOnce(json(passedChecks()))
      .mockResolvedValueOnce(json({ statuses: [] }))
      .mockResolvedValueOnce(json({ merged: true, sha: 'merge-sha' }))
      .mockResolvedValueOnce(json({ body: '<!-- codex-auto-merge-ledger:v1 -->' }, 201))
      .mockResolvedValueOnce(json({ ok: true }));

    await processCodexAutoMerge(env(), message, fetcher as typeof fetch);

    const mergeCall = fetcher.mock.calls.find(([url]) => String(url).endsWith('/pulls/344/merge'));
    expect((mergeCall?.[1] as RequestInit).method).toBe('PUT');
    expect(JSON.parse(String((mergeCall?.[1] as RequestInit).body))).toMatchObject({
      merge_method: 'merge',
      sha: 'head-sha',
    });
    const ledgerCall = fetcher.mock.calls.find(([url, init]) => (
      String(url).endsWith('/issues/344/comments') && (init as RequestInit).method === 'POST'
    ));
    expect(String((ledgerCall?.[1] as RequestInit).body)).toContain('codex-auto-merge-ledger:v1');
    expect(postedText(fetcher)).toContain('自動マージ完了');
  });
});
