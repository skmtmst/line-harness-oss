/*
 * 画面確認モックが「配列で返る口」を取り違えていないかの試験。
 *
 * ここを取り違えると、**画面が真っ白になる**。一覧の口が
 * `{items:[],total:0}` に落ちれば `xxx.filter is not a function`、
 * 1件返す口が `[]` に落ちれば `undefined.toLocaleString()` になる。
 * どちらも実際に起きた（2026-08-26）。
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { readArrayGetPaths } from './api-shapes.mjs';
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { IDENTITY_CANDIDATE_DETECTION, IDENTITY_CANDIDATE_EC, IDENTITY_CANDIDATE_ERROR, IDENTITY_CANDIDATE_FRIEND, IDENTITY_CANDIDATE_LISTS } from './fixtures.mjs';
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { MERGED_PERSON_DETAIL, MERGED_PERSON_EMPTY, MERGED_PERSON_ERROR } from './fixtures.mjs';

describe('画面確認モックの口の形', () => {
  const paths: Set<string> = readArrayGetPaths();

  it('一覧が配列で返る口を拾う', () => {
    for (const path of ['/api/tags', '/api/tag-groups', '/api/chats', '/api/scenarios', '/api/broadcasts', '/api/automations', '/api/rich-menu-groups']) {
      expect(paths.has(path), `${path} を配列の口として拾えていない`).toBe(true);
    }
  });

  it('1件だけ返す口を配列にしない', () => {
    // `/api/friends` は `PaginatedResponse`。配列にすると友だち一覧が落ちる。
    // `/api/friends/${id}/site-events` が `/api/friends` に化けて起きた。
    for (const path of ['/api/friends', '/api/dashboard/overview', '/api/list-stats', '/api/settings/features']) {
      expect(paths.has(path), `${path} を配列の口として拾ってしまっている`).toBe(false);
    }
  });

  it('読み取りが壊れたら黙って空にせず止める', () => {
    // 静かに0件になると、全部の口が `{items:[],total:0}` に落ちて
    // 全画面が真っ白になる。原因はどこにも出ない。
    expect(() => readArrayGetPaths('// api.ts が読めなかった場合')).toThrow(/配列の口/);
  });
});

describe('本人照合候補の画面確認データ', () => {
  it('友だち同士とEC会員を同じ契約で返す', () => {
    expect(Object.keys(IDENTITY_CANDIDATE_FRIEND).sort())
      .toEqual(Object.keys(IDENTITY_CANDIDATE_EC).sort());
    expect(IDENTITY_CANDIDATE_FRIEND.kind).toBe('friend_duplicate');
    expect(IDENTITY_CANDIDATE_EC.kind).toBe('ec_member');
  });

  it('通常・空・失敗を別の形で用意する', () => {
    expect(IDENTITY_CANDIDATE_LISTS.friend_duplicate).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(IDENTITY_CANDIDATE_LISTS.empty).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    expect(IDENTITY_CANDIDATE_ERROR).toMatchObject({ success: false, code: 'VISUAL_QA_ERROR' });
    expect(IDENTITY_CANDIDATE_DETECTION.normal).toEqual({
      processed: 1, hasMore: false, nextCursor: null,
    });
    expect(IDENTITY_CANDIDATE_DETECTION.empty).toEqual({
      processed: 0, hasMore: false, nextCursor: null,
    });
  });

  it('メールと電話を平文で置かない', () => {
    const serialized = JSON.stringify([
      IDENTITY_CANDIDATE_FRIEND,
      IDENTITY_CANDIDATE_EC,
    ]);
    expect(serialized).not.toContain('tanaka@example.jp');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).toContain('***');
  });
});

describe('統合ユーザー詳細の画面確認データ', () => {
  it('通常・空・失敗を別の形で用意する', () => {
    expect(MERGED_PERSON_DETAIL.linkedFriends).toHaveLength(2);
    expect(MERGED_PERSON_DETAIL.profileValues).toHaveLength(2);
    expect(MERGED_PERSON_EMPTY).toMatchObject({
      profileValues: [], deliveryPriorities: [], history: [],
    });
    expect(MERGED_PERSON_ERROR).toMatchObject({ success: false, code: 'VISUAL_QA_ERROR' });
  });

  it('0件を未取得へ変えず、平文のメールと電話を置かない', () => {
    expect(MERGED_PERSON_EMPTY.profileValues).toEqual([]);
    const serialized = JSON.stringify([MERGED_PERSON_DETAIL, MERGED_PERSON_EMPTY]);
    expect(serialized).not.toContain('tanaka@example.jp');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).toContain('***');
  });
});
