import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { collectSecurityCounts } from './security-monitor-counts.js';

const stores: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.raw.close(); });

it('every actual collection query seeks the UTC time index rather than scanning old audit rows', async () => {
  const store = createTestD1(); stores.push(store);
  const statements: string[] = [];
  const measured = { prepare(sql: string) {
    statements.push(sql);
    return store.db.prepare(sql);
  } } as D1Database;
  await collectSecurityCounts(measured, new Date('2026-10-16T16:00:00Z'));
  expect(statements).toHaveLength(3);
  for (const sql of statements) {
    const plan = store.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('2026-10-16T15:45:00Z', '2026-10-16T16:00:00Z');
    const text = JSON.stringify(plan);
    const table = sql.includes('FROM platform_audit_logs') ? 'platform_audit_logs' : 'audit_events';
    expect(text).toContain(`SEARCH ${table} USING INDEX idx_${table}_security_utc (security_created_at_jd>? AND security_created_at_jd<?)`);
    expect(text).not.toContain(`SCAN ${table}`);
  }
});

it('691 backfills old timestamps and maintains the indexed time through inserts and timestamp updates with a test clock', async () => {
  const store = createTestD1({ now: () => new Date('2026-10-16T16:00:00Z') }); stores.push(store);
  for (const [n, at] of ['2026-10-16T15:55:00Z', '2026-10-17T00:55:00.000', '2026-10-16T01:55:00-14:00', '2026-10-17T05:40:00+13:45'].entries()) {
    store.raw.prepare(`INSERT INTO audit_events (id, tenant_id, category, action, result, created_at)
      VALUES (?, 'test-tenant', 'auth', 'auth.fail', 'failed', ?)`).run(`a${n}`, at);
    store.raw.prepare(`INSERT INTO platform_audit_logs (id, staff_id, tenant_id, action, created_at)
      VALUES (?, 'test-operator', 'test-tenant', 'impersonation.start', ?)`).run(`p${n}`, at);
  }
  const counts = await collectSecurityCounts(store.db, new Date('2026-10-16T16:00:00Z'));
  expect(counts.find(row => row.rule_key === 'login_failures')?.count).toBe(4);
  expect(counts.find(row => row.rule_key === 'impersonation')?.count).toBe(4);
  for (const table of ['audit_events', 'platform_audit_logs']) {
    store.raw.prepare(`UPDATE ${table} SET created_at = '2026-10-16T15:44:59.999Z'`).run();
  }
  expect(await collectSecurityCounts(store.db, new Date('2026-10-16T16:00:00Z'))).toEqual([]);
});


it('the actual 691 migration backfills existing JST/UTC rows without changing their source timestamps', () => {
  const store = createTestD1(); stores.push(store);
  const raw = new Database(':memory:');
  try {
    raw.exec('CREATE TABLE line_accounts (id TEXT PRIMARY KEY)');
    for (const table of ['audit_events', 'platform_audit_logs']) {
      const { sql } = store.raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string };
      raw.exec(sql.replace(', security_created_at_jd REAL', ''));
    }
    raw.exec(`INSERT INTO audit_events (id,tenant_id,category,action,result,created_at)
      VALUES ('a','fixture','auth','auth.fail','failed','2026-10-17T00:55:00.000');
      INSERT INTO platform_audit_logs (id,staff_id,action,created_at)
      VALUES ('p','fixture','impersonation.start','2026-10-16T15:55:00Z');`);
    raw.exec(readFileSync(new URL('../../../../packages/db/migrations/691_security_monitor.sql', import.meta.url), 'utf8'));
    const expected = raw.prepare("SELECT julianday('2026-10-16T15:55:00Z') AS value").get() as { value: number };
    expect(raw.prepare('SELECT created_at,security_created_at_jd FROM audit_events').get()).toEqual({
      created_at: '2026-10-17T00:55:00.000', security_created_at_jd: expected.value,
    });
    expect(raw.prepare('SELECT security_created_at_jd FROM platform_audit_logs').get()).toEqual({ security_created_at_jd: expected.value });
  } finally { raw.close(); }
});
