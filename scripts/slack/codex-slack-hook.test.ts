import { describe, expect, test } from 'vitest';
import {
  CODEX_SLACK_RELAY_TIMEOUT_MS,
  hookEventType,
  parseOpenPrSnapshot,
  prNumberFromContent,
  repositoryFromRemote,
  repositoryRemoteName,
} from './codex-slack-hook.js';

describe('Codex Slack hook', () => {
  test('GitHubのHTTPSとSSHリモートを同じリポジトリ名にする', () => {
    expect(repositoryFromRemote('https://github.com/owner/repo.git')).toBe('owner/repo');
    expect(repositoryFromRemote('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  test('現在ブランチの追跡先をPRリンクのリポジトリとして優先する', () => {
    expect(repositoryRemoteName('fork', true)).toBe('fork');
    expect(repositoryRemoteName('origin', true)).toBe('origin');
    expect(repositoryRemoteName('.', true)).toBe('fork');
    expect(repositoryRemoteName(null, false)).toBe('origin');
  });

  test('CodexのフックをSlack用の種別に変換する', () => {
    expect(hookEventType('UserPromptSubmit')).toBe('prompt_submitted');
    expect(hookEventType('PermissionRequest')).toBe('approval_required');
    expect(hookEventType('Stop')).toBe('turn_completed');
    expect(hookEventType('PreToolUse')).toBeNull();
  });

  test('Slackの初回起票が複数API呼び出しでも完了するまで待つ', () => {
    expect(CODEX_SLACK_RELAY_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
  });

  test('完了報告のPR番号をPR帯チャンネルへの振り分けに使う', () => {
    expect(prNumberFromContent('PR #246 を検証環境へ反映しました')).toBe(246);
    expect(prNumberFromContent('PR#33・PR #60 を整理しました')).toBe(33);
    expect(prNumberFromContent('テスト443件、エラー0件')).toBeUndefined();
  });

  test('未完了PRの担当・チェック・変更重複を小さなスナップショットにする', () => {
    const snapshot = parseOpenPrSnapshot(JSON.stringify([
      {
        number: 220,
        title: '飲食店向け管理画面',
        url: 'https://github.com/example/repo/pull/220',
        author: { login: 'skmtmst' },
        headRefName: 'codex/masato-restaurant-test',
        isDraft: true,
        mergeStateStatus: 'UNKNOWN',
        updatedAt: '2026-08-20T00:00:00Z',
        files: [{ path: 'apps/web/page.tsx' }, { path: 'docs/release-log/unreleased.md' }],
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
      },
      {
        number: 254,
        title: 'Slack指令盤',
        url: 'https://github.com/example/repo/pull/254',
        author: { login: 'skmtmst' },
        headRefName: 'codex/kenta-slack-command-center',
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        updatedAt: '2026-08-22T00:00:00Z',
        files: [{ path: 'apps/web/page.tsx' }, { path: 'apps/worker/slack.ts' }],
        statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }],
      },
    ]));

    expect(snapshot).toEqual([
      expect.objectContaining({ number: 220, fileCount: 1, overlapsWith: [254], checks: 'pass' }),
      expect.objectContaining({ number: 254, fileCount: 2, overlapsWith: [220], checks: 'pending' }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('_files');
  });

  test('全PRで触る更新履歴だけは機能の変更重複として扱わない', () => {
    const snapshot = parseOpenPrSnapshot(JSON.stringify([
      { number: 220, title: 'A', url: 'https://github.com/x/y/pull/220', author: { login: 'x' }, files: [{ path: 'docs/release-log/unreleased.md' }] },
      { number: 254, title: 'B', url: 'https://github.com/x/y/pull/254', author: { login: 'x' }, files: [{ path: 'docs/release-log/unreleased.md' }] },
    ]));
    expect(snapshot?.map((pr) => pr.overlapsWith)).toEqual([[], []]);
  });
});
