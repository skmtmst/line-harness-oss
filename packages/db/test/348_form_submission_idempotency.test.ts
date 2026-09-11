import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  appendFormSubmitClaimStep,
  completeFormSubmitClaim,
  createFormSubmitClaim,
  ensureFormSubmitOutboxEvent,
  failFormSubmitClaim,
  findUnfinishedFormSubmitClaimByHash,
  getFormSubmitClaim,
  getFormSubmitOutbox,
  markFormSubmitOutboxDelivered,
  readFormSubmitClaimEffectStats,
  readFormSubmitClaimSteps,
  readFormSubmitOutboxPayload,
  saveFormSubmitClaimEffectStats,
  saveFormSubmitClaimWebhook,
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
      'version', 'lease_generation', 'effect_stats',
      'created_at', 'updated_at', 'expires_at']) {
      expect(columns.map((column) => column.name)).toContain(name);
    }
    const outbox = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'form_submit_outbox'`,
    ).get() as { name: string } | undefined;
    expect(outbox?.name).toBe('form_submit_outbox');
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
    expect(first.claim.version).toBe(1);
    expect(first.claim.lease_generation).toBe(1);

    // 同時送信の負け側は残っている行を受け取る
    const second = await createFormSubmitClaim(db, { ...input(), owner: 'owner-2' });
    expect(second.claimed).toBe(false);
    expect(second.claim.owner).toBe('owner-1');

    expect(await appendFormSubmitClaimStep(db, scope, 'owner-1', 'webhook', 1)).toBe(true);
    expect(await appendFormSubmitClaimStep(db, scope, 'owner-1', 'webhook', 1)).toBe(true);
    const reread = await getFormSubmitClaim(db, scope);
    expect(readFormSubmitClaimSteps(reread!)).toEqual(['webhook']);

    // 所有者が違う試行は工程を足せない
    expect(await appendFormSubmitClaimStep(db, scope, 'owner-2', 'answer', 1)).toBe(false);
    // 版が違う試行も工程を足せない(古い世代の書き込みの柵)
    expect(await appendFormSubmitClaimStep(db, scope, 'owner-1', 'answer', 2)).toBe(false);

    expect(await completeFormSubmitClaim(db, scope, 'owner-1', 1)).toBe(true);
    expect((await getFormSubmitClaim(db, scope))?.status).toBe('completed');
  });

  test('failed は即時、in_progress は古いものだけ横取りできる', async () => {
    await createFormSubmitClaim(db, input());
    // 新しい in_progress は横取りできない
    expect((await takeoverFormSubmitClaim(
      db, scope, 'owner-2', '2000-01-01T00:00:00+09:00', { owner: 'owner-1', version: 1 },
    )).taken).toBe(false);

    await failFormSubmitClaim(db, scope, 'owner-1', 1);
    // failed は即時に横取りできる。版と世代が進む。
    const took = await takeoverFormSubmitClaim(
      db, scope, 'owner-2', '2000-01-01T00:00:00+09:00', { owner: 'owner-1', version: 1 },
    );
    expect(took.taken).toBe(true);
    expect(took.generation).toBe(2);
    const taken = (await getFormSubmitClaim(db, scope))!;
    expect(taken.owner).toBe('owner-2');
    expect(taken.status).toBe('in_progress');
    expect(taken.version).toBe(2);
    expect(taken.lease_generation).toBe(2);
  });

  test('古い in_progress は横取りできる', async () => {
    await createFormSubmitClaim(db, input());
    sqlite.prepare(`UPDATE form_submit_claims SET updated_at = '2020-01-01T00:00:00+09:00'`).run();
    expect((await takeoverFormSubmitClaim(
      db, scope, 'owner-2', '2021-01-01T00:00:00+09:00', { owner: 'owner-1', version: 1 },
    )).taken).toBe(true);
  });

  test('横取りの競合は読み取った版の CAS で片方だけが勝つ', async () => {
    await createFormSubmitClaim(db, input());
    await failFormSubmitClaim(db, scope, 'owner-1', 1);
    // 2つの試行が同じ版を見て同時に横取りしたつもりでも、勝つのは1つ。
    const first = await takeoverFormSubmitClaim(
      db, scope, 'owner-A', '2000-01-01T00:00:00+09:00', { owner: 'owner-1', version: 1 },
    );
    const second = await takeoverFormSubmitClaim(
      db, scope, 'owner-B', '2000-01-01T00:00:00+09:00', { owner: 'owner-1', version: 1 },
    );
    expect(first.taken).toBe(true);
    expect(second.taken).toBe(false);
    expect((await getFormSubmitClaim(db, scope))?.owner).toBe('owner-A');
    // 負けた試行(古い版)の工程記録・完了・失敗は捨てられる。
    expect(await appendFormSubmitClaimStep(db, scope, 'owner-B', 'answer', 1)).toBe(false);
    expect(await completeFormSubmitClaim(db, scope, 'owner-B', 1)).toBe(false);
    expect(await failFormSubmitClaim(db, scope, 'owner-B', 1)).toBe(false);
    expect(await saveFormSubmitClaimWebhook(db, scope, 'owner-B', { passed: true, data: null }, 1)).toBe(false);
    // 勝った試行の記録は通る。
    expect(await appendFormSubmitClaimStep(db, scope, 'owner-A', 'answer', 2)).toBe(true);
  });

  test('outbox は意図行を作り、配達結果を最初の1回だけ残す', async () => {
    const ensured = await ensureFormSubmitOutboxEvent(db, scope, 'webhook', 'event-1');
    expect(ensured.status).toBe('pending');
    // 作り直さない。event_id も保つ。
    const again = await ensureFormSubmitOutboxEvent(db, scope, 'webhook', 'event-1');
    expect(again.event_id).toBe('event-1');

    expect(await markFormSubmitOutboxDelivered(
      db, scope, 'webhook', 'event-1', { passed: true, data: { ok: 1 } },
    )).toBe(true);
    // 2回目の上書きはしない。
    expect(await markFormSubmitOutboxDelivered(
      db, scope, 'webhook', 'event-1', { passed: false, data: null },
    )).toBe(false);
    const row = (await getFormSubmitOutbox(db, scope, 'webhook'))!;
    expect(row.status).toBe('delivered');
    expect(readFormSubmitOutboxPayload(row.payload)).toEqual({ passed: true, data: { ok: 1 } });
    expect(readFormSubmitOutboxPayload(null)).toBeNull();
    expect(readFormSubmitOutboxPayload('壊れた')).toBeNull();
  });

  test('効果ごとの集計は上書きで残し、合計が重ならない', async () => {
    await createFormSubmitClaim(db, input());
    expect(await saveFormSubmitClaimEffectStats(
      db, scope, 'owner-1', 1, 'layout:destinations:b1', { attempted: 1, succeeded: 1, failed: 0 },
    )).toBe(true);
    // 同じ効果の実行は上書きする(再実行の二重計上をしない)。
    expect(await saveFormSubmitClaimEffectStats(
      db, scope, 'owner-1', 1, 'layout:destinations:b1', { attempted: 1, succeeded: 1, failed: 0 },
    )).toBe(true);
    expect(await saveFormSubmitClaimEffectStats(
      db, scope, 'owner-1', 1, 'layout:choices:b2', { attempted: 2, succeeded: 1, failed: 1 },
    )).toBe(true);
    const reread = (await getFormSubmitClaim(db, scope))!;
    const stats = readFormSubmitClaimEffectStats(reread);
    expect(Object.keys(stats).sort()).toEqual(['layout:choices:b2', 'layout:destinations:b1']);
    const totals = Object.values(stats).reduce(
      (sum, entry) => ({
        attempted: sum.attempted + entry.attempted,
        succeeded: sum.succeeded + entry.succeeded,
        failed: sum.failed + entry.failed,
      }),
      { attempted: 0, succeeded: 0, failed: 0 },
    );
    expect(totals).toEqual({ attempted: 3, succeeded: 2, failed: 1 });
    // 古い版の書き込みは捨てる。
    expect(await saveFormSubmitClaimEffectStats(
      db, scope, 'owner-1', 9, 'layout:x', { attempted: 1, succeeded: 0, failed: 1 },
    )).toBe(false);
    expect(readFormSubmitClaimEffectStats({ effect_stats: '壊れた' })).toEqual({});
  });

  test('同じ内容の未完の予約を探せる。完了済みは対象外', async () => {
    await createFormSubmitClaim(db, input());
    const found = await findUnfinishedFormSubmitClaimByHash(
      db,
      { tenantId: scope.tenantId, lineAccountId: scope.lineAccountId, formId: scope.formId, friendId: scope.friendId },
      'hash-1',
    );
    expect(found?.idempotency_key).toBe(scope.key);
    expect(found?.request_hash).toBe('hash-1');
    // 違う内容は見つからない。
    await expect(findUnfinishedFormSubmitClaimByHash(
      db,
      { tenantId: scope.tenantId, lineAccountId: scope.lineAccountId, formId: scope.formId, friendId: scope.friendId },
      'hash-other',
    )).resolves.toBeNull();
    // 完了済みは対象外。
    await completeFormSubmitClaim(db, scope, 'owner-1', 1);
    await expect(findUnfinishedFormSubmitClaimByHash(
      db,
      { tenantId: scope.tenantId, lineAccountId: scope.lineAccountId, formId: scope.formId, friendId: scope.friendId },
      'hash-1',
    )).resolves.toBeNull();
  });

  test('知らない scope は null', async () => {
    await expect(getFormSubmitClaim(db, { ...scope, key: 'no-such-key' })).resolves.toBeNull();
  });

  test('壊れた工程記録は空として読む', () => {
    expect(readFormSubmitClaimSteps({ steps: 'not-json' })).toEqual([]);
    expect(readFormSubmitClaimSteps({ steps: '{"a":1}' })).toEqual([]);
  });
});
