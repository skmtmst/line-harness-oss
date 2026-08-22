import { describe, expect, test } from 'vitest';
import {
  CODEX_SLACK_RELAY_TIMEOUT_MS,
  hookEventType,
  prNumberFromContent,
  repositoryFromRemote,
} from './codex-slack-hook.js';

describe('Codex Slack hook', () => {
  test('GitHubのHTTPSとSSHリモートを同じリポジトリ名にする', () => {
    expect(repositoryFromRemote('https://github.com/owner/repo.git')).toBe('owner/repo');
    expect(repositoryFromRemote('git@github.com:owner/repo.git')).toBe('owner/repo');
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
});
