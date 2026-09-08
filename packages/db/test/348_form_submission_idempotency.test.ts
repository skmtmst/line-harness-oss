import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  appendFormSubmitClaimStep,
  completeFormSubmitClaim,
  createFormSubmitClaim,
  failFormSubmitClaim,
  getFormSubmitClaim,
  readFormSubmitClaimSteps,
  takeoverFormSubmitClaim,
  type FormSubmitClaimScope,
} from '../src/forms.js';
import { asD1 } from './d1-test-helper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  join(HERE, '..', 'migrations', '348_form_submission_idempotency.sql'),
  'utf8',
);

const scope: FormSubmitClaimScope = {
  tenantId: 'tenant-1',
  lineAccountId: 'account-a',
  formId: 'form-1',
  friendId: 'friend-1',
  key: '11111111-2222-4333-8444-555555555555',
};

function input(overrides: Record<string, string> = {}) {
  return {
    ...scope,
    requestHash: 'hash-1',
    submissionId: 'answer-1',
    owner: 'owner-1',
    expiresAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('348_form_submission_idempotency.sql', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(MIGRATION);
  });

  test('予約表と索引を作る', () => {
    const table = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'form_submit_claims'`,
    ).get() as { name: string } | undefined;
    expect(table?.name).toBe('form_submit_claims');
    const columns = sqlite.prepare(`PRAGMA table_info(form_submit_claims)`).all() as Array<{ name: string }>;
    for (const name of ['tenant_id', 'line_account_id', 'form_id', 'friend_id', 'idempotency_key',
      'request_hash', 'status', 'steps', 'webhook', 'submission_id', 'owner',
      'created_at', 'updated_at', 'expires_at']) {
      expect(columns.map((column) => column.name)).toContain(name);
    }
  });

  test('同じ scope・キーの2回目の確保は主キーで失敗する(同時送信の片方だけが進む前提)', () => {
    const insert = sqlite.prepare(
      `INSERT INTO form_submit_claims
         (tenant_id, line_account_id, form_id, friend_id, idempotency_key,
          request_hash, status, steps, webhook, submission_id,
          owner, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'hash-1', 'in_progress', '[]', NULL, 'answer-1',
               'owner-1', 'now', 'now', 'later')`,
    );
    insert.run('tenant-1', 'account-a', 'form-1', 'friend-1', scope.key);
    expect(() => insert.run('tenant-1', 'account-a', 'form-1', 'friend-1', scope.key))
      .toThrow(/UNIQUE constraint failed/);
  });

  test('scope が違えば同じキーで独立に確保できる', () => {
    const insert = sqlite.prepare(
      `INSERT INTO form_submit_claims
         (tenant_id, line_account_id, form_id, friend_id, idempotency_key,
          request_hash, status, steps, webhook, submission_id,
          owner, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'hash-1', 'in_progress', '[]', NULL, 'answer-1',
               'owner-1', 'now', 'now', 'later')`,
    );
    // テナント・友だち・フォーム違いは別 scope
    insert.run('tenant-1', 'account-a', 'form-1', 'friend-1', scope.key);
    insert.run('tenant-2', 'account-a', 'form-1', 'friend-1', scope.key);
    insert.run('tenant-1', 'account-a', 'form-1', 'friend-2', scope.key);
    insert.run('tenant-1', 'account-a', 'form-2', 'friend-1', scope.key);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM form_submit_claims`).get() as { n: number };
    expect(count.n).toBe(4);
  });

  test('状態は in_progress/failed/completed だけ', () => {
    expect(() => sqlite.exec(
      `INSERT INTO form_submit_claims
         (tenant_id, line_account_id, form_id, friend_id, idempotency_key,
          request_hash, status, steps, owner, created_at, updated_at, expires_at)
       VALUES ('t', 'a', 'f', 'fr', 'k', 'h', 'done', '[]', 'o', 'now', 'now', 'later')`,
    )).toThrow(/CHECK constraint failed/);
  });
});

describe('予約ヘルパー(実 SQL)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(MIGRATION);
    db = asD1(sqlite);
  });

  test('確保・読み返し・工程記録・完了', async () => {
    const first = await createFormSubmitClaim(db, input());
    expect(first.claimed).toBe(true);
    expect(first.claim.status).toBe('in_progress');
    expect(first.claim.submission_id).toBe('answer-1');

    // 同時送信の負け側は残っている行を受け取る
    const second = await createFormSubmitClaim(db, { ...input(), owner: 'owner-2' });
    expect(second.claimed).toBe(false);
    expect(second.claim.owner).toBe('owner-1');

    expect(await appendFormSubmitClaimStep(db, scope, 'owner-1', 'webhook')).toBe(true);
    expect(await appendFormSubmitClaimStep(db, scope, 'owner-1', 'webhook')).toBe(true);
    const reread = await getFormSubmitClaim(db, scope);
    expect(readFormSubmitClaimSteps(reread!)).toEqual(['webhook']);

    // 所有者が違う試行は工程を足せない
    expect(await appendFormSubmitClaimStep(db, scope, 'owner-2', 'answer')).toBe(false);

    expect(await completeFormSubmitClaim(db, scope, 'owner-1')).toBe(true);
    expect((await getFormSubmitClaim(db, scope))?.status).toBe('completed');
  });

  test('failed は即時、in_progress は古いものだけ横取りできる', async () => {
    await createFormSubmitClaim(db, input());
    // 新しい in_progress は横取りできない
    expect(await takeoverFormSubmitClaim(db, scope, 'owner-2', '2000-01-01T00:00:00+09:00')).toBe(false);

    await failFormSubmitClaim(db, scope, 'owner-1');
    // failed は即時に横取りできる
    expect(await takeoverFormSubmitClaim(db, scope, 'owner-2', '2000-01-01T00:00:00+09:00')).toBe(true);
    expect((await getFormSubmitClaim(db, scope))?.owner).toBe('owner-2');
    expect((await getFormSubmitClaim(db, scope))?.status).toBe('in_progress');
  });

  test('古い in_progress は横取りできる', async () => {
    await createFormSubmitClaim(db, input());
    sqlite.prepare(`UPDATE form_submit_claims SET updated_at = '2020-01-01T00:00:00+09:00'`).run();
    expect(await takeoverFormSubmitClaim(db, scope, 'owner-2', '2021-01-01T00:00:00+09:00')).toBe(true);
  });

  test('知らない scope は null', async () => {
    await expect(getFormSubmitClaim(db, { ...scope, key: 'no-such-key' })).resolves.toBeNull();
  });

  test('壊れた工程記録は空として読む', () => {
    expect(readFormSubmitClaimSteps({ steps: 'not-json' })).toEqual([]);
    expect(readFormSubmitClaimSteps({ steps: '{"a":1}' })).toEqual([]);
  });
});
