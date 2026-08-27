import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '193_incoming_webhook_and_entry_route_owner.sql'),
  'utf8',
);

describe('migration 193 ownership columns', () => {
  it('adds only nullable ownership columns without changing existing values or row counts', () => {
    const db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE incoming_webhooks (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, source_type TEXT NOT NULL,
        secret TEXT, is_active INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE entry_routes (
        id TEXT PRIMARY KEY, ref_code TEXT NOT NULL, name TEXT NOT NULL,
        redirect_url TEXT, is_active INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO incoming_webhooks VALUES ('wh-1', 'Webhook', 'custom', 'secret', 1, 'before', 'before');
      INSERT INTO entry_routes VALUES ('route-1', 'public-ref', 'Route', 'https://example.com', 1, 'before', 'before');
    `);

    const incomingBefore = db.prepare('SELECT * FROM incoming_webhooks').all();
    const routesBefore = db.prepare('SELECT * FROM entry_routes').all();
    const incomingColumnsBefore = db.prepare('PRAGMA table_info(incoming_webhooks)').all();
    const routeColumnsBefore = db.prepare('PRAGMA table_info(entry_routes)').all();

    db.exec(migration);

    const incomingAfter = db.prepare('SELECT * FROM incoming_webhooks').all() as Array<Record<string, unknown>>;
    const routesAfter = db.prepare('SELECT * FROM entry_routes').all() as Array<Record<string, unknown>>;
    expect(incomingAfter.map(({ line_account_id: _owner, ...row }) => row)).toEqual(incomingBefore);
    expect(routesAfter.map(({ tenant_id: _owner, ...row }) => row)).toEqual(routesBefore);
    expect(incomingAfter).toHaveLength(incomingBefore.length);
    expect(routesAfter).toHaveLength(routesBefore.length);
    expect(incomingAfter[0].line_account_id).toBeNull();
    expect(routesAfter[0].tenant_id).toBeNull();
    expect(db.prepare('PRAGMA table_info(incoming_webhooks)').all()).toHaveLength(incomingColumnsBefore.length + 1);
    expect(db.prepare('PRAGMA table_info(entry_routes)').all()).toHaveLength(routeColumnsBefore.length + 1);
  });
});
