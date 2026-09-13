import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(directory, 'page.tsx'), 'utf8');
const overview = readFileSync(join(directory, 'nen-overview.tsx'), 'utf8');
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
    expect(page).toContain('api.nenCampaigns.deliveries(selectedAccountId, { limit: 20 })');
    expect(page).toContain('api.nenCampaigns.flowMetrics(selectedAccountId)');
    expect(page).toContain('api.nenCampaigns.columnMetrics(selectedAccountId, 90)');
    expect(page).toContain('api.nenCampaigns.petMetrics(selectedAccountId)');
    expect(page).toContain('api.nenCampaigns.columns(selectedAccountId)');
    expect(page).toContain('api.nenCampaigns.pets(selectedAccountId)');
    expect(page).toContain('api.nenCampaigns.birthdayCoupon(selectedAccountId)');
    expect(editor).toContain('api.nenCampaigns.settings(selectedAccountId)');
    expect(api).toContain('lineAccountId=${encodeURIComponent(accountId)}');
  });

  test('配信履歴では内部の英語状態を運用者向けの日本語へ変える', () => {
    expect(overview).toContain("pending: 'これから送ります'");
    expect(overview).toContain("failed: '届きませんでした'");
    expect(overview).not.toContain('>{job.status}</span>');
  });

  test('誕生日クーポンはV6どおり3日前10時と案内する', () => {
    expect(overview).toContain('誕生日は3日前の10:00に送ります');
    expect(overview).not.toContain('誕生日月の1日に自動送信');
    expect(overview).toContain('formatCampaignTiming(setting)');
  });

  test('取得済みの失敗・待機件数を表示し、配信日時を日本時間へ変える', () => {
    expect(overview).toContain('deliveryList.summary.pending + deliveryList.summary.processing');
    expect(overview).toContain('deliveryList.summary.failed + deliveryList.summary.skipped');
    expect(overview).toContain('formatNenJobDateTime(delivery.sentAt || delivery.scheduledAt)');
    expect(overview).not.toContain('予定：{delivery.scheduledAt}');
  });

  test('一覧の読込失敗を0件や空状態として表示しない', () => {
    // 1件の失敗で画面全体をエラーにしない(点検 #512 の中3)。失敗はそのタブの帯で示す。
    expect(page).toContain('tabErrors');
    expect(page).toContain('tone="danger"');
    expect(page).toContain('もう一度読み込む');
    expect(page).not.toContain('loadError');
  });
});
