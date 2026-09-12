/*
 * リッチメニューの画面確認モックが本物と約束違いしていないかの試験。
 *
 * mock が参照系 (GET) だけだと、編集・公開・予約・適用・削除の画面検証が
 * mock で再現できず、画面と口のずれを隠す (点検 #502 の中)。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_API = readFileSync(join(HERE, 'mock-api.mjs'), 'utf8');

describe('リッチメニューの画面確認モック', () => {
  it('書き込み系の成功形を返す', () => {
    for (const path of [
      "'/api/rich-menu-groups'",
      "'/api/rich-menu-groups/reorder-priorities'",
      // 公開・取下・予約・適用は1本の正規表現で受ける。
      '(publish|unpublish|schedule|apply-to-tag)',
    ]) {
      expect(MOCK_API.includes(path), `mock に ${path} がない`).toBe(true);
    }
  });

  it('409 と 400 の代表例を返す', () => {
    // 削除ブロック・冪等キーなし・順序の形違い。
    expect(MOCK_API).toContain('rich_menu_delete_blocked');
    expect(MOCK_API).toContain('Idempotency-Key header required');
    expect(MOCK_API).toContain('orderedIds must be string array');
  });

  it('削除は未知と既定メニューと通常で分ける', () => {
    expect(MOCK_API).toContain("writeHead(409)");
    expect(MOCK_API).toContain('rich-menu-target');
  });
});
