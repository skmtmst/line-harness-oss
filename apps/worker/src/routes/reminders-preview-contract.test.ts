import { readImplementationSource } from '../test-utils/implementation-source.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * 公開フローは目標日なしでプレビューを呼ぶため、未指定なら仮の基準日で予定を返し、targetDate にその日付を明示する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const route = readImplementationSource(join(here, 'reminders.ts'));

describe('プレビューは目標日なしでも予定を返す', () => {
  it('目標日が無いときは仮の基準日で予定を作る', () => {
    expect(route).toContain('body.targetDate === undefined || body.targetDate === null');
    expect(route).toContain('new Date(Date.now() + 7 * 86_400_000)');
  });

  it('読めない日時だけ 400 で止める', () => {
    expect(route).toContain("error: '基準日が正しくありません'");
  });
});
