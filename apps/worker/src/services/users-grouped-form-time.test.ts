import { expect, it } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { computeUsersGrouped } from './users-grouped.js';

it('友だちの統合一覧は実時刻で最新のフォーム回答を使う', async () => {
  const db = createTestD1({ foreignKeys: false });
  try {
    db.raw.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('a', 'ca', 'A', 'token', 'secret');
      INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f', 'Uf', 'a');
      INSERT INTO forms (id, name) VALUES ('form', '申込');
      INSERT INTO form_submissions (id, form_id, friend_id, data, created_at) VALUES
        ('older', 'form', 'f', '{"x_username":"old"}', '2026-10-02T01:00:00'),
        ('newer', 'form', 'f', '{"x_username":"new"}', '2026-10-01 17:00:00');
    `);
    const result = await computeUsersGrouped(db.db, { allowedAccountIds: ['a'] });
    expect(result.rows[0]?.xUsername).toBe('new');
  } finally {
    db.raw.close();
  }
});
