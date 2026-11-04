import { expect, it } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { getMergedPerson, listMergedPeople } from './merged-people.js';

it('統合ユーザーの日時表示と一覧順を実時刻でそろえる', async () => {
  const db = createTestD1({ foreignKeys: false });
  try {
    db.raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
        VALUES ('a','ca','A','fixture','fixture','tenant');
      INSERT INTO users (id, tenant_id, created_at, updated_at) VALUES
        ('later','tenant','2026-10-01 17:00:00','2026-10-01 17:00:00'),
        ('earlier','tenant','2026-10-02T01:00:00','2026-10-02T01:00:00');
      INSERT INTO friends (id, line_user_id, line_account_id, user_id) VALUES
        ('f1','u1','a','later'), ('f2','u2','a','earlier')`);
    const list = await listMergedPeople(db.db, 'tenant', ['a'], 20, 0);
    expect(list.items.map(({ id, updatedAt }) => [id, updatedAt])).toEqual([
      ['later', '2026-10-01T17:00:00Z'], ['earlier', '2026-10-02T01:00:00+09:00'],
    ]);
    expect(await getMergedPerson(db.db, 'tenant', 'later')).toMatchObject({ createdAt: '2026-10-01T17:00:00Z' });
  } finally { db.raw.close(); }
});
