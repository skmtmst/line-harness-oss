import { describe, expect, test } from 'vitest';
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
