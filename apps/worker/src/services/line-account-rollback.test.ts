import { describe, expect, test, vi } from 'vitest';
import { deleteUncommittedLineAccount } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { detectFollowerImportCapability } from './follower-import.js';

/**
 * R564: LINE接続途中の能力判定失敗で、削除済みアカウントの設定行が残る。
 * 合格条件: 能力判定失敗を繰り返しても未確定アカウントとその設定行が残らない。
 */
describe('R564: 接続中断時の巻き戻しは設定行を残さない', () => {
  test('unknown判定→巻き戻しでアカウントもfollower_import_v1設定も残らない', async () => {
    const { db, raw } = createTestD1({ foreignKeys: true });
    raw.prepare(
      'INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, ?, ?, ?, ?)',
    ).run('account-r564', '1000000001', 'rollback-test', 'synthetic-token', 'synthetic-secret');

    const state = await detectFollowerImportCapability(
      db,
      { getFollowerIds: async () => { throw new Error('synthetic timeout'); } },
      'account-r564',
    );
    expect(state.capability).toBe('unknown');

    await deleteUncommittedLineAccount(db, 'account-r564');

    expect(raw.prepare('SELECT id FROM line_accounts WHERE id = ?').get('account-r564')).toBeUndefined();
    expect(
      raw.prepare('SELECT key FROM account_settings WHERE line_account_id = ?').all('account-r564'),
    ).toEqual([]);
  });

  test('失敗を繰り返しても設定行がたまらない', async () => {
    const { db, raw } = createTestD1({ foreignKeys: true });
    for (let i = 0; i < 3; i += 1) {
      const id = `account-r564-retry-${i}`;
      raw.prepare(
        'INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, ?, ?, ?, ?)',
      ).run(id, `100000000${i}`, 'rollback-test', 'synthetic-token', 'synthetic-secret');
      const state = await detectFollowerImportCapability(
        db,
        { getFollowerIds: async () => { throw new Error('synthetic timeout'); } },
        id,
      );
      expect(state.capability).toBe('unknown');
      await deleteUncommittedLineAccount(db, id);
    }
    expect(raw.prepare('SELECT COUNT(*) AS n FROM line_accounts').get() as { n: number }).toMatchObject({ n: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM account_settings').get() as { n: number }).toMatchObject({ n: 0 });
  });

  test('巻き戻しは接続確認の記録行も残さない', async () => {
    // 本番D1と同じく外部キーOFF: CASCADEに頼らず消すことを確かめる。
    const { db, raw } = createTestD1();
    raw.prepare(
      'INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, ?, ?, ?, ?)',
    ).run('account-r564-checks', '1000000009', 'rollback-test', 'synthetic-token', 'synthetic-secret');
    raw.prepare(
      `INSERT INTO line_account_connection_checks
         (id, line_account_id, check_kind, result, checked_by, checked_at,
          correlation_id, idempotency_key, account_revision)
       VALUES (?, ?, 'bot_info', 'ok', 'staff-1', '2026-09-30T09:00:00+09:00', 'corr-1', 'idem-1', 1)`,
    ).run('check-1', 'account-r564-checks');

    await deleteUncommittedLineAccount(db, 'account-r564-checks');

    expect(raw.prepare('SELECT id FROM line_accounts WHERE id = ?').get('account-r564-checks')).toBeUndefined();
    expect(
      raw.prepare('SELECT id FROM line_account_connection_checks WHERE line_account_id = ?').all('account-r564-checks'),
    ).toEqual([]);
  });
});

/**
 * D1 では親行の DELETE 自体が通らないことがある（HTTP 400 / code 7500
 * `triggers nested too deep`）。line_accounts を ON DELETE CASCADE で参照する表が
 * 116 経路あり、文を組み立てる時点で上限を超えるため、行数には依存しない。
 * 子行を先に消しても通らないので、巻き戻しは行を無効化して一意列を解放する。
 * 合格条件: 親行 DELETE が失敗しても、同じチャネルをもう一度登録できる。
 */
describe('親行の DELETE が D1 で失敗したときの巻き戻し', () => {
  /** 親行の DELETE だけを D1 と同じように失敗させる。 */
  function withParentDeleteFailure(db: D1Database): D1Database {
    const parentDelete = /DELETE\s+FROM\s+line_accounts\b/i;
    const fail = () => {
      throw new Error('D1_ERROR: triggers nested too deep: SQLITE_ERROR');
    };
    return {
      ...db,
      prepare: (sql: string) => {
        const statement = db.prepare(sql);
        if (!parentDelete.test(sql)) return statement;
        return {
          ...statement,
          bind: (...args: unknown[]) => ({ ...statement.bind(...args), run: fail }),
        } as unknown as D1PreparedStatement;
      },
    } as unknown as D1Database;
  }

  test('行は残るが無効化され、同じチャネルをもう一度登録できる', async () => {
    const { db, raw } = createTestD1({ foreignKeys: true });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    raw
      .prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, login_channel_id, liff_id, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run('account-del-fail', 'channel-del-fail', '削除できない一時行', 'token-x', 'secret-x', 'login-del-fail', 'liff-del-fail');
    raw
      .prepare(`INSERT INTO account_settings (line_account_id, key, value) VALUES (?, 'follower_import_v1', '{}')`)
      .run('account-del-fail');

    await deleteUncommittedLineAccount(withParentDeleteFailure(db), 'account-del-fail');

    const row = raw
      .prepare(
        `SELECT channel_id, login_channel_id, liff_id, channel_access_token, channel_secret,
                is_active, is_default, archived_at
           FROM line_accounts WHERE id = ?`,
      )
      .get('account-del-fail') as Record<string, unknown>;
    expect(row).toMatchObject({
      channel_id: 'abandoned:account-del-fail',
      login_channel_id: null,
      liff_id: null,
      channel_access_token: '',
      channel_secret: '',
      is_active: 0,
      is_default: 0,
    });
    expect(row.archived_at).toBeTruthy();
    // 子行は親行を消せなくても片付いている。
    expect(raw.prepare('SELECT line_account_id FROM account_settings WHERE line_account_id = ?').all('account-del-fail')).toEqual([]);
    // 失敗はログに残す（秘密値は出さない）。
    expect(errors.mock.calls[0]?.[0]).toContain('line_account_rollback_delete_failed');
    errors.mockRestore();

    // ここが本題。一意列が解放されているので、同じチャネルを登録し直せる。
    expect(() =>
      raw
        .prepare(
          `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, login_channel_id, liff_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('account-retry', 'channel-del-fail', '再登録', 'token-y', 'secret-y', 'login-del-fail', 'liff-del-fail'),
    ).not.toThrow();
  });
});
