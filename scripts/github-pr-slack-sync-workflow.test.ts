import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const workflow = readFileSync(
  new URL('../.github/workflows/github-pr-slack-sync.yml', import.meta.url),
  'utf8',
);
const script = readFileSync(
  new URL('./github-slack-pr-sync.ts', import.meta.url),
  'utf8',
);

describe('GitHub PR Slack sync workflow safety', () => {
  test('PRイベント、developmentへのpush、毎時、手動実行で再照合できる', () => {
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('push:');
    expect(workflow).toContain("cron: '17 * * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('GITHUB_SLACK_SYNC_ONLY_PR_NUMBER:');
    expect(workflow).toContain("inputs.pr_number || ''");
    expect(workflow).toContain('codex/development');
  });

  test('明示的な有効化まで動かず、PR headのコードを秘密値付きで実行しない', () => {
    expect(workflow).toContain("vars.SLACK_PR_SYNC_ENABLED == 'true'");
    expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(workflow).toContain('ref: ${{ github.event.pull_request.base.sha || github.sha }}');
    expect(workflow).toContain('CODEX_SLACK_RELAY_SECRET: ${{ secrets.CODEX_SLACK_RELAY_SECRET }}');
    expect(workflow).not.toContain('github.event.pull_request.head.sha');
  });

  test('過去の監査済みPRを再投稿せず、秘密値をログへ出さない', () => {
    expect(workflow).toContain("GITHUB_SLACK_SYNC_MIN_PR_NUMBER: '276'");
    expect(workflow).not.toMatch(/\bset\s+-x\b/);
    expect(workflow).not.toMatch(/echo[^\n]*\$(?:GITHUB_TOKEN|CODEX_SLACK_RELAY_SECRET)/);
    expect(script).not.toMatch(/console\.(?:log|error)\([^\n]*(?:githubToken|relaySecret|signature|payload)/);
    expect(script).toContain('console.log(JSON.stringify(result));');
  });
});
