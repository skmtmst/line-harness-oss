import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { getUserByIdForAccess, getUsersForAccess } from '../src/users.js';
import { asD1 } from './d1-test-helper.js';

it('旧 UTC と時差なし JST のユーザーを実時刻で表示し並べる', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`INSERT INTO tenants(id, name) VALUES ('tenant', 'Tenant');
      INSERT INTO users(id, tenant_id, created_at, updated_at) VALUES
      ('later', 'tenant', '2026-10-01 17:00:00', '2026-10-01 17:00:00'),
      ('earlier', 'tenant', '2026-10-02T01:00:00', '2026-10-02T01:00:00')`);
    const db = asD1(sqlite);
    const scope = { tenantId: 'tenant', allowedAccountIds: [], includeUnlinked: true };
    expect((await getUsersForAccess(db, scope)).map(({ id, created_at }) => [id, created_at])).toEqual([
      ['later', '2026-10-01T17:00:00Z'], ['earlier', '2026-10-02T01:00:00+09:00'],
    ]);
    expect(await getUserByIdForAccess(db, 'later', scope)).toMatchObject({ updated_at: '2026-10-01T17:00:00Z' });
  } finally { sqlite.close(); }
});
