import { createHash, randomUUID } from 'node:crypto';
import type { CfApiCreds } from './types.js';
import { executeD1Query } from './cf-api/d1.js';

const TABLE = '_musubo_migration_history';
const NAME = /^\d{3,}_[A-Za-z0-9_-]+\.sql$/;
export type MigrationFiles = ReadonlyMap<string, Buffer>;
export function migrationChecksum(sql: Buffer): string {
  return createHash('sha256').update(sql).digest('hex');
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Local SQL generation only. The caller must independently verify the complete applied baseline. */
export function migrationBaselineSql(files: MigrationFiles, evidence: string, options: { ready?: boolean } = {}): string {
  if (!evidence.trim() || evidence.length > 500) throw new Error('migration_baseline_evidence_required');
  for (const name of files.keys()) if (!NAME.test(name)) throw new Error('migration_name_invalid');
  // No IF NOT EXISTS: an existing journal must never be silently overwritten.
  return [
    `CREATE TABLE ${TABLE} (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('ready','applying','applied')), evidence TEXT NOT NULL, updated_at TEXT NOT NULL);`,
    `INSERT INTO ${TABLE} VALUES ('__lock__','','applying',${quote(evidence)},datetime('now'));`,
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);',
    ...Array.from(files, ([name, sql]) => migrationRecordSql(name, sql, evidence)),
    ...(options.ready === false ? [] : [`UPDATE ${TABLE} SET state='ready' WHERE name='__lock__';`]),
  ].join('\n');
}

/** Only after a fresh database's bootstrap or individual migration completed successfully. */
export function migrationRecordSql(name: string, sql: Buffer, evidence = 'fresh-install'): string {
  if (!NAME.test(name)) throw new Error('migration_name_invalid');
  return `INSERT INTO ${TABLE} VALUES (${quote(name)},${quote(migrationChecksum(sql))},'applied',${quote(evidence)},datetime('now'));\n`
    + `INSERT OR IGNORE INTO _migrations (name,applied_at) VALUES (${quote(name)},datetime('now'));`;
}

type History = { name: string; sha256: string; state: string; evidence: string };
export async function applyTrackedMigrations(opts: {
  creds: CfApiCreds; databaseId: string; names: string[]; files: MigrationFiles;
  onMigration?: (name: string, status: 'running' | 'done' | 'skipped') => Promise<void>;
}): Promise<void> {
  if (!opts.names.length) return;
  if (new Set(opts.names).size !== opts.names.length) throw new Error('migration_names_duplicated');
  for (const name of opts.names) {
    if (!NAME.test(name) || !opts.files.has(name)) throw new Error(`migration_bundle_missing_or_invalid: ${name}`);
  }
  const query = (sql: string, params: unknown[] = []) => executeD1Query({ creds: opts.creds, databaseId: opts.databaseId, sql, params });
  const exists = await query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [TABLE]);
  if (!exists.result[0]?.results?.length) throw new Error('migration_baseline_required: verify applied SQL and initialize the checksum history before updating');
  const result = await query(`SELECT name,sha256,state,evidence FROM ${TABLE}`);
  const history = new Map<string, History>((result.result[0]?.results ?? []).map((row: History) => [row.name, row]));
  const lock = history.get('__lock__');
  if (!lock || lock.state !== 'ready') throw new Error('migration_recovery_required: previous update is running or its outcome is unknown');
  const legacy = await query('SELECT name FROM _migrations');
  const legacyNames = new Set<string>((legacy.result[0]?.results ?? []).map((row: {name:string}) => row.name));
  const pending: string[] = [];
  // Validate every selected file before executing any migration.
  for (const name of opts.names) {
    const row = history.get(name);
    if (!row) {
      if (legacyNames.has(name)) throw new Error(`migration_baseline_required: unverified legacy entry ${name}`);
      pending.push(name); continue;
    }
    if (row.state !== 'applied') throw new Error(`migration_recovery_required: ${name}`);
    if (row.sha256 !== migrationChecksum(opts.files.get(name)!)) throw new Error(`migration_checksum_mismatch: ${name}`);
  }
  if (!pending.length) {
    for (const name of opts.names) await opts.onMigration?.(name, 'skipped');
    return;
  }
  const owner = randomUUID();
  await query(`UPDATE ${TABLE} SET state='applying',evidence=?,updated_at=datetime('now') WHERE name='__lock__' AND state='ready'`, [owner]);
  const acquired = await query(`SELECT evidence FROM ${TABLE} WHERE name='__lock__' AND state='applying'`);
  if (acquired.result[0]?.results?.[0]?.evidence !== owner) throw new Error('migration_update_already_running');
  const latest = await query(`SELECT name,sha256,state,evidence FROM ${TABLE}`);
  const lockedHistory = new Map<string, History>((latest.result[0]?.results ?? []).map((row: History) => [row.name, row]));
  // On ANY failure leave the lock and applying row intact. A timeout may have committed SQL;
  // automatic replay or declaring it applied would both be unsafe.
  for (const name of opts.names) {
    const applied = lockedHistory.get(name);
    if (applied) {
      if (applied.state !== 'applied' || applied.sha256 !== migrationChecksum(opts.files.get(name)!)) throw new Error(`migration_recovery_required: ${name}`);
      await opts.onMigration?.(name, 'skipped'); continue;
    }
    const sql = opts.files.get(name)!;
    await opts.onMigration?.(name, 'running');
    await query(`INSERT INTO ${TABLE} VALUES (?,?,'applying',?,datetime('now'))`, [name, migrationChecksum(sql), owner]);
    await query(sql.toString('utf8'));
    await query(`UPDATE ${TABLE} SET state='applied',updated_at=datetime('now') WHERE name=? AND evidence=? AND state='applying'`, [name, owner]);
    await query('INSERT OR IGNORE INTO _migrations (name,applied_at) VALUES (?,datetime(\'now\'))', [name]);
    await opts.onMigration?.(name, 'done');
  }
  await query(`UPDATE ${TABLE} SET state='ready',updated_at=datetime('now') WHERE name='__lock__' AND evidence=?`, [owner]);
}
