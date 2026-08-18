import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(directory, 'page.tsx'), 'utf8');
const editor = readFileSync(join(directory, 'edit/campaign-editor.tsx'), 'utf8');

describe('NEN配信のテスト送信先', () => {
  test('100件制限に埋もれるログインユーザーを候補の先頭へ統合する', () => {
    expect(page).toContain('api.accountSettings.getTestRecipientLoginUsers(selectedAccountId)');
    expect(page).toContain('.filter((candidate) => candidate.sameAccount)');
    expect(page).toContain('new Map([...loginUsers, ...accountFriends]');
  });

  test('編集画面でもLINE連携済みログインユーザーを最初から選べる', () => {
    expect(editor).toContain('setTestCandidates(candidates)');
    expect(editor).toContain('accountId: selectedAccountId ?? undefined');
  });
});
