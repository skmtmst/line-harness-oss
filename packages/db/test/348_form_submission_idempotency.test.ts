import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { createFormSubmission, getFormSubmissionById } from '../src/forms.js';
import { asD1 } from './d1-test-helper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  join(HERE, '..', 'migrations', '348_form_submission_idempotency.sql'),
  'utf8',
);

const BASE_TABLE = `
  CREATE TABLE forms (
    id TEXT PRIMARY KEY,
    submit_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  );
  CREATE TABLE form_submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL,
    friend_id TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    destination_write_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
  INSERT INTO forms (id, submit_count, updated_at)
  VALUES ('form-1', 0, '2026-09-08T00:00:00+09:00');
`;

describe('348_form_submission_idempotency.sql', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(BASE_TABLE);
    sqlite.exec(MIGRATION);
  });

  test('回答行にハッシュと期限の置き場を足す', () => {
    const columns = sqlite.prepare(`PRAGMA table_info(form_submissions)`).all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('idempotency_hash');
    expect(columns.map((column) => column.name)).toContain('idempotency_expires_at');
  });

  test('期限つきの行を期限で絞り込める', () => {
    const index = sqlite.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_form_submissions_idempotency_expires'`,
    ).get() as { name: string } | undefined;
    expect(index?.name).toBe('idx_form_submissions_idempotency_expires');
  });

  test('キー・ハッシュ・期限つきで保存し、id で読み返せる', async () => {
    const db = asD1(sqlite);
    const key = '11111111-2222-4333-8444-555555555555';
    const created = await createFormSubmission(db, {
      id: key,
      formId: 'form-1',
      friendId: 'friend-1',
      data: JSON.stringify({ full_name: '山田' }),
      idempotencyHash: 'hash-1',
      idempotencyExpiresAt: '2026-09-09T00:00:00.000Z',
    });
    expect(created.id).toBe(key);

    const reread = await getFormSubmissionById(db, key);
    expect(reread?.form_id).toBe('form-1');
    expect(reread?.friend_id).toBe('friend-1');
    expect(reread?.idempotency_hash).toBe('hash-1');
    expect(reread?.idempotency_expires_at).toBe('2026-09-09T00:00:00.000Z');
  });

  test('キーなし送信はこれまでどおり採番し、冪等列は空', async () => {
    const db = asD1(sqlite);
    const created = await createFormSubmission(db, {
      formId: 'form-1',
      friendId: 'friend-1',
      data: JSON.stringify({ full_name: '山田' }),
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.idempotency_hash).toBeNull();
    expect(created.idempotency_expires_at).toBeNull();
  });

  test('同じキーの2回目の保存は主キーで失敗する(同時送信の負け側の前提)', async () => {
    const db = asD1(sqlite);
    const key = '22222222-3333-4444-8555-666666666666';
    const input = {
      id: key,
      formId: 'form-1',
      friendId: 'friend-1',
      data: JSON.stringify({ full_name: '山田' }),
      idempotencyHash: 'hash-1',
      idempotencyExpiresAt: '2026-09-09T00:00:00.000Z',
    };
    await createFormSubmission(db, input);
    await expect(createFormSubmission(db, input)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  test('知らない id は null を返す', async () => {
    await expect(getFormSubmissionById(asD1(sqlite), 'no-such-id')).resolves.toBeNull();
  });
});
