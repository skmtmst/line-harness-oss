import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(import.meta.dirname, '..', 'migrations', '738_line_account_creator.sql'), 'utf8');

describe('LINE account creator migration', () => {
  it('backfills only same-tenant automatic connection checks', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE staff_members(id TEXT PRIMARY KEY, tenant_id TEXT);
      CREATE TABLE line_accounts(id TEXT PRIMARY KEY, tenant_id TEXT);
      CREATE TABLE line_account_connection_checks(id TEXT PRIMARY KEY, line_account_id TEXT, checked_by TEXT, checked_at TEXT, idempotency_key TEXT);
      INSERT INTO staff_members VALUES ('creator','tenant-a'), ('other','tenant-b');
      INSERT INTO line_accounts VALUES ('auto','tenant-a'), ('manual','tenant-a'), ('wrong-tenant','tenant-a');
      INSERT INTO line_account_connection_checks VALUES
        ('1','auto','creator','2026-10-01','auto-connect-1'),
        ('2','manual','creator','2026-10-01','manual-1'),
        ('3','wrong-tenant','other','2026-10-01','auto-connect-3');
    `);
    db.exec(migration);
    const rows = db.prepare('SELECT id, created_by_staff_id AS creator FROM line_accounts ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'auto', creator: 'creator' },
      { id: 'manual', creator: null },
      { id: 'wrong-tenant', creator: null },
    ]);
    db.close();
  });
});
