import { describe, expect, test } from 'vitest';
import { hookEventType, repositoryFromRemote } from './codex-slack-hook.js';

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
});
