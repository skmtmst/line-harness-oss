import { describe, expect, it } from 'vitest';
import { FOLDER_SELECT_COLORS, isFolderSelectColor } from './folder-colors.js';

describe('フォルダAPIの9色の共通検査', () => {
  it('9色すべてと色なしを受け付ける', () => {
    expect(new Set(FOLDER_SELECT_COLORS.map(option => option.value)).size).toBe(9);
    for (const option of FOLDER_SELECT_COLORS) expect(isFolderSelectColor(option.value)).toBe(true);
    expect(isFolderSelectColor(null)).toBe(true);
  });
  it.each(['#123456', '#16A34A', '#123', 'red', '', undefined, 1, {}, false])('選択肢にない値を拒む: %j', value => {
    expect(isFolderSelectColor(value)).toBe(false);
  });
});
