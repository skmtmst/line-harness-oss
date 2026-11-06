/** Local-only preparation. Never connects to a database or executes generated SQL. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationBaselineSql, migrationChecksum } from '../../packages/update-engine/src/migration-history.js';
interface Evidence {
  databaseId: string;
  sourceRevision: string;
  reviewedBy: string;
  completeAppliedHistory: boolean;
  migrations: { name: string; sha256: string }[];
}
const args = process.argv.slice(2);
function option(name: string): string {
  const value = args[args.indexOf(name) + 1];
  if (!args.includes(name) || !value || value.startsWith('--')) throw new Error(`Required: ${name}`);
  return value;
}
const directory = resolve(option('--migrations-dir'));
const evidence = JSON.parse(readFileSync(option('--evidence-file'), 'utf8')) as Evidence;
if (evidence.completeAppliedHistory !== true || !evidence.databaseId?.trim() || !/^[0-9a-f]{40}$/i.test(evidence.sourceRevision)
    || !evidence.reviewedBy?.trim() || !Array.isArray(evidence.migrations) || !evidence.migrations.length) {
  throw new Error('The baseline requires a reviewed complete applied history, database identity and exact source commit.');
}
const files = new Map<string, Buffer>();
for (const row of evidence.migrations) {
  if (!/^\d{3,}_[A-Za-z0-9_-]+\.sql$/.test(row.name) || files.has(row.name)) throw new Error('Invalid/duplicate migration name');
  const bytes = readFileSync(resolve(directory, row.name));
  if (migrationChecksum(bytes) !== row.sha256) throw new Error(`Reviewed checksum differs: ${row.name}`);
  files.set(row.name, bytes);
}
const audit = `${evidence.databaseId} ${evidence.sourceRevision} reviewed:${evidence.reviewedBy}`;
const sql = migrationBaselineSql(files, audit);
writeFileSync(option('--out'), sql, { flag: 'wx' });
console.log(`Prepared ${files.size} verified migration records. No database connection or SQL execution was performed.`);
