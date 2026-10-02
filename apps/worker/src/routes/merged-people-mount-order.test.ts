import { describe, expect, it } from 'vitest';
import { app } from '../index.js';

/*
 * R393: 統合ユーザー一覧APIが友だち詳細のルートに先取りされ404になる。
 *
 * GET /api/friends/people は mergedPeople（duplicates 経由）の固定パスだが、
 * friends の GET /api/friends/:id より後に載ると people を友だちIDと読んで
 * 404（Friend not found）になる。登録順そのものを固定する。
 *  mount を戻すと赤になる（people が :id の後ろへ行く）。
 */
describe('R393 統合ユーザー一覧の固定パス優先', () => {
  it('GET /api/friends/people が GET /api/friends/:id より先に登録される', () => {
    const paths = app.routes
      .filter((route) => route.method === 'GET')
      .map((route) => route.path);
    const people = paths.indexOf('/api/friends/people');
    const detail = paths.indexOf('/api/friends/:id');
    expect(people).toBeGreaterThanOrEqual(0);
    expect(detail).toBeGreaterThanOrEqual(0);
    expect(people).toBeLessThan(detail);
  });
});
