import type Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

/**
 * R550: 同時登録で同じLINE LoginチャネルID・LIFF IDを複数アカウントへ保存できる。
 * migration 542 の一意制約が、重複SELECT→INSERTの窓をDB側で塞ぐ。
 */
describe('R550: Login/LIFF識別子の一意制約', () => {
  function insertAccount(
    raw: Database.Database,
    id: string,
    channelId: string,
    loginChannelId: string | null,
    liffId: string | null,
  ) {
    raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, login_channel_id, liff_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, channelId, `name-${id}`, 'token', 'secret', loginChannelId, liffId);
  }

  test('同じlogin_channel_idの2行目はUNIQUE違反で止まる', () => {
    const { raw } = createTestD1();
    insertAccount(raw, 'account-A', '1001', 'same-login', 'liff-A');
    expect(() => insertAccount(raw, 'account-B', '1002', 'same-login', 'liff-B'))
      .toThrow(/UNIQUE constraint failed/i);
    expect(
      raw.prepare('SELECT COUNT(*) AS n FROM line_accounts').get() as { n: number },
    ).toMatchObject({ n: 1 });
  });

  test('同じliff_idの2行目はUNIQUE違反で止まる', () => {
    const { raw } = createTestD1();
    insertAccount(raw, 'account-A', '1001', 'login-A', 'same-liff');
    expect(() => insertAccount(raw, 'account-B', '1002', 'login-B', 'same-liff'))
      .toThrow(/UNIQUE constraint failed/i);
    expect(
      raw.prepare('SELECT COUNT(*) AS n FROM line_accounts').get() as { n: number },
    ).toMatchObject({ n: 1 });
  });

  test('未設定(NULL)は複数行あってもよい', () => {
    const { raw } = createTestD1();
    insertAccount(raw, 'account-A', '1001', null, null);
    insertAccount(raw, 'account-B', '1002', null, null);
    expect(
      raw.prepare('SELECT COUNT(*) AS n FROM line_accounts').get() as { n: number },
    ).toMatchObject({ n: 2 });
  });
});
