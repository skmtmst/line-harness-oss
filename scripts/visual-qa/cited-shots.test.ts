/*
 * 判定の出典として名指しした絵が、版に残っているかの試験。
 *
 * PNG は `.gitignore` で版から外している（作り直せるうえ、履歴を 528MB
 * 太らせていた）。**名指ししたものだけを `git add -f` で残す**という決め。
 *
 * この形の弱点は、新しい判定を書いたとき `git add -f` を忘れると
 * **静かに漏れる**こと。ここで落として気づけるようにする。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { citedShots, ROOT } from './cited-shots.mjs';

/** その絵が置かれうる2か所。名前からはどちらか決まらない。 */
function candidates(shot: string): string[] {
  return [join(ROOT, 'docs', 'design-qa', shot), join(ROOT, 'docs', 'design-reference', shot)];
}

const CITED: string[] = citedShots();

const tracked = new Set(
  execFileSync('git', ['ls-files', 'docs/design-qa', 'docs/design-reference'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.endsWith('.png'))
    .map((line) => line.replace(/^docs\/design-(qa|reference)\//, '')),
);

describe('判定の出典に名指しした絵', () => {
  it('名指しの形が読み取れている（0件なら読み取りが壊れている）', () => {
    expect(CITED.length).toBeGreaterThan(20);
  });

  it('名指しした絵が、作業ツリーに在る', () => {
    const missing = CITED.filter((shot) => !candidates(shot).some(existsSync));
    expect(missing, `撮り直すか、出典を直してください:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('名指しした絵が、版に入っている', () => {
    /*
      `.gitignore` が PNG を外しているので、名指ししたものは
      `git add -f docs/design-qa/<機能>/<名前>.png` で入れる。
    */
    const untracked = CITED.filter((shot) => !tracked.has(shot));
    expect(untracked, `\`git add -f\` で版に入れてください:\n  ${untracked.join('\n  ')}`).toEqual([]);
  });
});
