import { describe, expect, it } from 'vitest';
// @ts-expect-error 画面確認用の固定データは素のJSで管理する。
import { FRIEND_ADD_LIFECYCLE_DRAFT, FRIEND_ADD_LIFECYCLE_EMPTY, FRIEND_ADD_LIFECYCLE_ERROR, FRIEND_ADD_LIFECYCLE_PUBLISHED, FRIEND_ADD_LIFECYCLE_TEST_RESULT, FRIEND_ADD_LIFECYCLE_VALIDATION } from './fixtures.mjs';

describe('友だち追加時配信の画面確認データ', () => {
  it('本物の下書き・確認・試験・公開契約と同じ項目を持つ', () => {
    expect(FRIEND_ADD_LIFECYCLE_DRAFT).toMatchObject({
      accountId: 'visual-qa-account',
      status: 'draft',
      lastTestStatus: 'succeeded',
    });
    expect(FRIEND_ADD_LIFECYCLE_VALIDATION).toMatchObject({
      canPublish: true,
      conflicts: [],
      lastTestStatus: 'succeeded',
    });
    expect(FRIEND_ADD_LIFECYCLE_VALIDATION.checks.map((item: { key: string }) => item.key)).toEqual([
      'first_time', 'returning', 'actions', 'duplicate_prevention',
    ]);
    expect(FRIEND_ADD_LIFECYCLE_TEST_RESULT.stateChanged).toBe(false);
    expect(FRIEND_ADD_LIFECYCLE_PUBLISHED).toMatchObject({
      duplicatePrevention: 'webhook_event',
      monitoringPath: '/friend-add-settings/runs',
    });
  });

  it('空と失敗を別のHTTP状態・別の文で保持する', () => {
    expect(FRIEND_ADD_LIFECYCLE_EMPTY).toEqual({
      status: 404,
      body: { success: false, error: '確認する下書きがありません' },
    });
    expect(FRIEND_ADD_LIFECYCLE_ERROR).toEqual({
      status: 500,
      body: { success: false, error: '下書きを読み込めませんでした' },
    });
  });
});
