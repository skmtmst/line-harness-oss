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
import {
  WEBINAR_NOTIFICATION_SETTINGS,
  WEBINAR_NOTIFICATION_SETTINGS_EMPTY,
  WEBINAR_NOTIFICATION_SETTINGS_FAILURE,
  WEBINAR_OVERVIEW,
  WEBINAR_OVERVIEW_EMPTY,
  WEBINAR_OVERVIEW_FAILURE,
} from './fixtures.mjs';

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

  it('ウェビナー一覧は通常・空・失敗を同じ形にせず、未取得を0にしない', () => {
    expect(WEBINAR_OVERVIEW.metrics.registrations).toMatchObject({
      value: 428, state: 'available',
    });
    expect(WEBINAR_OVERVIEW.metrics.viewers).toMatchObject({
      value: null, state: 'unavailable',
    });
    expect(WEBINAR_OVERVIEW_EMPTY.metrics.registrations).toMatchObject({
      value: 0, state: 'available',
    });
    expect(WEBINAR_OVERVIEW_FAILURE).toEqual({
      success: false, error: 'Internal server error',
    });
  });

  it('ウェビナー通知は申込人数と予約件数を混ぜず、空だけを0にする', () => {
    expect(WEBINAR_NOTIFICATION_SETTINGS.overview.audience).toEqual({
      people: 184,
      bookings: 191,
      definition: 'active_registrations',
    });
    expect(WEBINAR_NOTIFICATION_SETTINGS_EMPTY.overview.audience).toEqual({
      people: 0,
      bookings: 0,
      definition: 'active_registrations',
    });
    expect(WEBINAR_NOTIFICATION_SETTINGS_FAILURE).toEqual({
      success: false,
      error: 'Internal server error',
    });
  });
});
