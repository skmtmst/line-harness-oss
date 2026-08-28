import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(directory, 'page.tsx'), 'utf8');
const editor = readFileSync(join(directory, 'edit/campaign-editor.tsx'), 'utf8');
const api = readFileSync(join(directory, '../../lib/api.ts'), 'utf8');

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

  test('設定・履歴・コラム・ペット・クーポンを選択中LINEアカウントへ限定する', () => {
    expect(page).toContain('api.nenCampaigns.settings(selectedAccountId)');
    expect(page).toContain('api.nenCampaigns.jobs(selectedAccountId)');
    expect(page).toContain('api.nenCampaigns.columns(selectedAccountId)');
    expect(page).toContain('api.nenCampaigns.pets(selectedAccountId)');
    expect(page).toContain('api.nenCampaigns.birthdayCoupon(selectedAccountId)');
    expect(editor).toContain('api.nenCampaigns.settings(selectedAccountId)');
    expect(api).toContain('lineAccountId=${encodeURIComponent(accountId)}');
  });

  test('配信履歴では内部の英語状態を運用者向けの日本語へ変える', () => {
    expect(page).toContain("pending: '配信待ち'");
    expect(page).toContain("failed: '送信できませんでした'");
    expect(page).not.toContain('>{job.status}</span>');
  });

  test('誕生日クーポンはV6どおり3日前10時と案内する', () => {
    expect(page).toContain('誕生日の3日前、10:00に自動送信');
    expect(page).not.toContain('誕生日月の1日に自動送信');
  });
});
