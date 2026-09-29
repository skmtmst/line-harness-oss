import { describe, expect, it } from 'vitest';
import { classifyUidMapping, protectCsvCell } from '../src/friend-migrations';

const OLD = { id: 'old', display_name: '旧', user_id: null };
const NEW = { id: 'new', display_name: '新', user_id: null };

describe('UID移行の事前確認', () => {
  it('検証済み根拠で新旧が見つかれば自動一致にする', () => {
    expect(classifyUidMapping({ oldFriend: OLD, newFriend: NEW, evidenceType: 'line_login' }))
      .toEqual({ classification: 'auto', reason: null });
  });

  it('運用者CSVは人の確認を必須にする', () => {
    expect(classifyUidMapping({ oldFriend: OLD, newFriend: NEW, evidenceType: 'operator_csv' }).classification)
      .toBe('review');
  });

  it('見つからないUIDを0件や自動一致にしない', () => {
    expect(classifyUidMapping({ oldFriend: OLD, newFriend: null, evidenceType: 'line_login' }).classification)
      .toBe('unmatched');
  });

  it('別の統合ユーザー同士は競合にする', () => {
    expect(classifyUidMapping({
      oldFriend: { ...OLD, user_id: 'user-a' },
      newFriend: { ...NEW, user_id: 'user-b' },
      evidenceType: 'line_login',
    }).classification).toBe('conflict');
  });
});

describe('CSV書き出し', () => {
  it('表計算ソフトで式として動く先頭文字を無害化する', () => {
    expect(protectCsvCell('=HYPERLINK("https://bad")')).toBe('"\'=HYPERLINK(""https://bad"")"');
    expect(protectCsvCell('+1')).toBe("'+1");
  });
});
