/** Local, disposable D1 only. Never connects to staging/production or sends Slack. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import Database from 'better-sqlite3';
import { collectSecurityCounts } from '../src/services/security-monitor-counts.js';

const negative = process.argv.includes('--negative-control');
const now = new Date('2026-10-16T16:00:00Z');
const schema = new Database(':memory:');
schema.exec(readFileSync(new URL('../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
const objects = schema.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL
  AND tbl_name IN ('audit_events','platform_audit_logs') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`).all() as Array<{ sql: string }>;
schema.close();
const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("local benchmark"); } };',
  compatibilityDate: '2026-03-17', d1Databases: ['DB'] });
try {
  const db = await mf.getD1Database('DB');
  // The only referenced foreign table; none of the synthetic events has an account.
  await db.prepare('CREATE TABLE line_accounts (id TEXT PRIMARY KEY)').run();
  for (const { sql } of objects) await db.prepare(sql).run();
  for (const total of [100_000, 1_000_000]) {
    for (const table of ['audit_events', 'platform_audit_logs']) await db.prepare(`DELETE FROM ${table}`).run();
    // 900 events (one per second) in the current window; all remaining rows are
    // within the preceding day, so a broad date prefilter cannot pass this check.
    for (const table of ['audit_events', 'platform_audit_logs']) {
      const columns = table === 'audit_events' ? 'tenant_id,category,action,result' : 'tenant_id,staff_id,action';
      const values = table === 'audit_events' ? "'fixture-tenant','auth','auth.fail','failed'" : "'fixture-tenant','fixture-operator','impersonation.start'";
      for (let start = 0; start < total; start += 10_000) {
        await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(?) UNION ALL SELECT x+1 FROM n WHERE x < ?)
          INSERT INTO ${table} (id,${columns},created_at)
          SELECT CAST(x AS TEXT),${values},strftime('%Y-%m-%dT%H:%M:%fZ', ?,
            printf('-%d seconds', CASE WHEN x < 900 THEN x ELSE 1800 + (x % 86400) END)) FROM n`)
          .bind(start, Math.min(total, start + 10_000) - 1, now.toISOString()).run();
      }
    }
    const queries: Array<{ table: string; rowsRead: number; durationMs: number; plan: unknown }> = [];
    if (negative) {
      for (const table of ['audit_events', 'platform_audit_logs']) await db.prepare(`DROP INDEX idx_${table}_security_utc`).run();
    }
    const measured = { prepare(input: string) {
      const sql = negative ? input.replace(/ INDEXED BY idx_\w+_security_utc/g, '') : input;
      return { bind(...args: unknown[]) { return { async all() {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all();
      const result = await db.prepare(sql).bind(...args).all();
      queries.push({ table: sql.includes('FROM platform_audit_logs') ? 'platform_audit_logs' : 'audit_events',
        rowsRead: Number(result.meta.rows_read), durationMs: result.meta.duration, plan: plan.results });
      return result;
    } }; } }; } } as unknown as D1Database;
    const started = performance.now();
    const cpu = process.cpuUsage();
    const counts = await collectSecurityCounts(measured, now);
    const cpuUsed = process.cpuUsage(cpu);
    const elapsedMs = performance.now() - started;
    if (counts.find(row => row.rule_key === 'login_failures')?.count !== 900 ||
        counts.find(row => row.rule_key === 'impersonation')?.count !== 900) throw new Error('incorrect_recent_counts');
    console.log(JSON.stringify({ runtime: 'local Miniflare D1 (not remote staging)', negativeControl: negative,
      totalPerTable: total, recentPerTable: 900, elapsedMs,
      driverCpuMs: (cpuUsed.user + cpuUsed.system) / 1000,
      rowsRead: queries.reduce((n, q) => n + q.rowsRead, 0), queries }));
    for (const query of queries) {
      assert.ok(JSON.stringify(query.plan).includes(`USING INDEX idx_${query.table}_security_utc`) && query.rowsRead <= 10_000, 'time_index_or_read_budget_failed');
    }

  }
  const writeOverhead = [];
  for (const table of ['audit_events', 'platform_audit_logs']) {
    const columns = table === 'audit_events' ? 'tenant_id,category,action,result' : 'tenant_id,staff_id,action';
    const values = table === 'audit_events' ? "'fixture-tenant','auth','auth.fail','failed'" : "'fixture-tenant','fixture-operator','impersonation.start'";
    const insert = (id: string) => db.prepare(`INSERT INTO ${table} (id,${columns},created_at)
      VALUES (?,${values},'2026-10-01T00:00:00Z')`).bind(id).run();
    const indexed = await insert('write-probe-indexed');
    await db.prepare(`DROP TRIGGER ${table}_security_time_insert`).run();
    await db.prepare(`DROP TRIGGER ${table}_security_time_update`).run();
    await db.prepare(`DROP INDEX idx_${table}_security_utc`).run();
    const baseline = await insert('write-probe-baseline');
    writeOverhead.push({ table, indexedRowsWritten: indexed.meta.rows_written,
      baselineRowsWritten: baseline.meta.rows_written, extraRowsWritten: indexed.meta.rows_written - baseline.meta.rows_written });
  }
  console.log(JSON.stringify({ runtime: 'local Miniflare D1 (not remote staging)', writeOverhead }));
} finally { await mf.dispose(); }
