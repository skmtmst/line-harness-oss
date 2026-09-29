import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../migrations/287_line_account_credential_metadata.sql', import.meta.url),
);

describe('migration 287: line account credential metadata', () => {
  it('backfills update dates only for configured credentials', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE line_accounts (
        id TEXT PRIMARY KEY,
        channel_access_token TEXT,
        channel_secret TEXT,
        channel_access_token_encrypted TEXT,
        channel_secret_encrypted TEXT,
        login_channel_secret TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO line_accounts VALUES
        ('configured', '', '', 'encrypted-token', 'encrypted-secret', 'login-secret', '2026-09-01T10:00:00.000+09:00'),
        ('empty', '', '', NULL, NULL, '', '2026-09-02T10:00:00.000+09:00');
    `);

    db.exec(readFileSync(migrationPath, 'utf8'));

    const configured = db.prepare(`
      SELECT channel_access_token_updated_at, channel_secret_updated_at,
             login_channel_secret_updated_at
        FROM line_accounts WHERE id = 'configured'
    `).get();
    const empty = db.prepare(`
      SELECT channel_access_token_updated_at, channel_secret_updated_at,
             login_channel_secret_updated_at
        FROM line_accounts WHERE id = 'empty'
    `).get();

    expect(configured).toEqual({
      channel_access_token_updated_at: '2026-09-01T10:00:00.000+09:00',
      channel_secret_updated_at: '2026-09-01T10:00:00.000+09:00',
      login_channel_secret_updated_at: '2026-09-01T10:00:00.000+09:00',
    });
    expect(empty).toEqual({
      channel_access_token_updated_at: null,
      channel_secret_updated_at: null,
      login_channel_secret_updated_at: null,
    });
    db.close();
  });
});
