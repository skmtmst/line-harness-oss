import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { getAffiliateByCode, getAffiliateById, getAffiliates } from '../src/affiliates.js';
import { getAffiliateByFriendId } from '../src/affiliate-links.js';
import { asD1 } from './d1-test-helper.js';

it('紹介者の旧 UTC と時差なし JST の作成時刻を表示し並べる', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`INSERT INTO tenants(id, name) VALUES ('tenant', 'Tenant');
      INSERT INTO line_accounts(id, channel_id, name, channel_access_token, channel_secret, tenant_id)
        VALUES ('a','ca','A','fixture','fixture','tenant');
      INSERT INTO friends(id, line_user_id, line_account_id) VALUES ('f','Uf','a');
      INSERT INTO affiliates(id, tenant_id, line_account_id, name, code, friend_id, created_at) VALUES
        ('later','tenant','a','Later','later','f','2026-10-01 17:00:00'),
        ('earlier','tenant','a','Earlier','earlier',NULL,'2026-10-02T01:00:00')`);
    const db = asD1(sqlite), scope = { tenantId: 'tenant', allowedLineAccountIds: ['a'] };
    expect((await getAffiliates(db, scope)).map(({ id, created_at }) => [id, created_at])).toEqual([
      ['later', '2026-10-01T17:00:00Z'], ['earlier', '2026-10-02T01:00:00+09:00'],
    ]);
    for (const record of [await getAffiliateById(db, 'later', scope), await getAffiliateByCode(db, 'later'), await getAffiliateByFriendId(db, 'f', 'a')]) {
      expect(record?.created_at).toBe('2026-10-01T17:00:00Z');
    }
  } finally { sqlite.close(); }
});
