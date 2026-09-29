import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * 機能7（リマインダ）の配信予定プレビューの再発防止。
 *
 * 公開フローの画面は目標日を持たずに POST /api/reminders/:id/preview を呼ぶ。
 * 口が目標日なしを 400 で返すと、STEP4 の確認が permanent に壊れる。
 * 目標日が無いときは仮の基準日で予定を返し、仮の日付は結果の targetDate に入れる。
 */

const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(join(here, 'reminders.ts'), 'utf8');

describe('プレビューは目標日なしでも予定を返す', () => {
  it('目標日が無いときは仮の基準日で予定を作る', () => {
    expect(route).toContain('body.targetDate === undefined || body.targetDate === null');
    expect(route).toContain('new Date(Date.now() + 7 * 86_400_000)');
  });

  it('読めない日時だけ 400 で止める', () => {
    expect(route).toContain("error: '基準日が正しくありません'");
  });
});
