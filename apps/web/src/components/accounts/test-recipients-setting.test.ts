import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'test-recipients-setting.tsx'),
  'utf8',
);

describe('テスト送信先のログインユーザー候補', () => {
  test('保存済み送信先とLINE連携済みログインユーザーを同時に読み込む', () => {
    expect(source).toContain('api.accountSettings.getTestRecipients(accountId)');
    expect(source).toContain('api.accountSettings.getTestRecipientLoginUsers(accountId)');
  });

  test('保存済みの人を除外し、ログインユーザーから追加できる', () => {
    expect(source).toContain('ログインユーザーから追加');
    expect(source).toContain('!recipientIds.has(candidate.id)');
    expect(source).toContain('onClick={() => addRecipient(candidate)}');
  });
});
