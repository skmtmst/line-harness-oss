import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  AD_CONVERSION_OUTBOX_MAX_ATTEMPTS,
  claimAdConversionOutboxDue,
  enqueueAdConversionOutbox,
  finishAdConversionOutbox,
  takeAdConversionOutboxRow,
} from '../src/ad-platforms.js';
import { toJstString } from '../src/utils.js';

const migration = readFileSync(
  join(import.meta.dirname, '../migrations/366_ad_conversion_outbox.sql'),
  'utf8',
);

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

const BASE_SCHEMA = `
  CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
  CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT REFERENCES line_accounts(id));
  CREATE TABLE ad_platforms (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}', is_active INTEGER DEFAULT 1,
    line_account_id TEXT REFERENCES line_accounts(id)
  );
`;

function seedDb(): { db: D1Database; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.exec(BASE_SCHEMA);
  raw.exec(migration);
  raw.exec(`INSERT INTO line_accounts (id) VALUES ('a1')`);
  raw.exec(`INSERT INTO friends (id, line_account_id) VALUES ('f1', 'a1')`);
  raw.exec(`INSERT INTO ad_platforms (id, name, line_account_id) VALUES ('p1', 'meta', 'a1')`);
  return { db: asD1(raw), raw };
}

const BASE = {
  platformId: 'p1',
  friendId: 'f1',
  lineAccountId: 'a1',
  eventName: 'Purchase',
  eventValue: 1000,
  currency: 'JPY',
  idempotencyKey: 'evt-1',
};

describe('366 広告送信の待ち行列', () => {
  it('同じ鍵の二重登録は初回の1行にまとまる', async () => {
    const { db, raw } = seedDb();
    const first = await enqueueAdConversionOutbox(db, BASE);
    const second = await enqueueAdConversionOutbox(db, { ...BASE, eventValue: 2000 });
    expect(second).toBe(first);
    const count = raw.prepare(`SELECT COUNT(*) AS n FROM ad_conversion_outbox`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('送り時が来た行だけ取り出す', async () => {
    const { db, raw } = seedDb();
    await enqueueAdConversionOutbox(db, BASE);
    await enqueueAdConversionOutbox(db, { ...BASE, idempotencyKey: 'evt-future' });
    raw.prepare(`UPDATE ad_conversion_outbox SET next_attempt_at = ? WHERE idempotency_key = 'evt-future'`)
      .run(toJstString(new Date(Date.now() + 60 * 60 * 1000)));

    const claimed = await claimAdConversionOutboxDue(db);
    expect(claimed.map((row) => row.idempotency_key)).toEqual(['evt-1']);
    expect(claimed[0]?.status).toBe('sending');
    expect(claimed[0]?.lease_token).toBeTruthy();
    expect(claimed[0]?.attempt_count).toBe(1);
  });

  it('同時に取り合っても証を持つのは1件だけ', async () => {
    const { db } = seedDb();
    const id = await enqueueAdConversionOutbox(db, BASE);
    const [first, second] = await Promise.all([
      takeAdConversionOutboxRow(db, id),
      takeAdConversionOutboxRow(db, id),
    ]);
    // 送り中の行は奪えない。古い送り中の取り直しは期限付きの取り出し側の役目。
    expect([first !== null, second !== null].filter(Boolean)).toHaveLength(1);
  });

  it('済みの行は掴み直せる。送り中だけが譲る条件', async () => {
    const { db } = seedDb();
    const id = await enqueueAdConversionOutbox(db, BASE);
    const lease = (await takeAdConversionOutboxRow(db, id)) as string;
    await finishAdConversionOutbox(db, { id, lease, status: 'sent' });

    const retake = await takeAdConversionOutboxRow(db, id);
    expect(retake).toBeTruthy();
    expect(await takeAdConversionOutboxRow(db, id)).toBeNull();
  });

  it('失敗は待ち時間を延ばし、上限超えは取り出さない', async () => {
    const { db, raw } = seedDb();
    const id = await enqueueAdConversionOutbox(db, BASE);
    const lease = (await takeAdConversionOutboxRow(db, id)) as string;
    await finishAdConversionOutbox(db, { id, lease, status: 'failed', errorMessage: 'bad' });

    const row = raw.prepare(`SELECT status, attempt_count, next_attempt_at FROM ad_conversion_outbox WHERE id = ?`)
      .get(id) as { status: string; attempt_count: number; next_attempt_at: string };
    expect(row.status).toBe('failed');
    expect(row.attempt_count).toBe(1);
    expect(row.next_attempt_at > toJstString(new Date())).toBe(true);

    // まだ送り時でない。
    expect(await claimAdConversionOutboxDue(db)).toHaveLength(0);

    // 上限まで試した行は取り出さない。
    raw.prepare(`UPDATE ad_conversion_outbox SET attempt_count = ?, next_attempt_at = NULL WHERE id = ?`)
      .run(AD_CONVERSION_OUTBOX_MAX_ATTEMPTS, id);
    expect(await claimAdConversionOutboxDue(db)).toHaveLength(0);
  });

  it('古い sending は落ちた取り出しと見て取り直す', async () => {
    const { db, raw } = seedDb();
    const id = await enqueueAdConversionOutbox(db, BASE);
    await takeAdConversionOutboxRow(db, id);
    raw.prepare(`UPDATE ad_conversion_outbox SET updated_at = '2000-01-01T00:00:00.000+09:00' WHERE id = ?`).run(id);

    const claimed = await claimAdConversionOutboxDue(db);
    expect(claimed.map((row) => row.id)).toEqual([id]);
  });

  it('成功で片付き、他人の証では書けない', async () => {
    const { db, raw } = seedDb();
    const id = await enqueueAdConversionOutbox(db, BASE);
    const lease = (await takeAdConversionOutboxRow(db, id)) as string;
    await finishAdConversionOutbox(db, { id, lease: 'someone-else', status: 'sent' });
    const kept = raw.prepare(`SELECT status FROM ad_conversion_outbox WHERE id = ?`).get(id) as { status: string };
    expect(kept.status).toBe('sending');

    await finishAdConversionOutbox(db, { id, lease, status: 'sent' });
    const done = raw.prepare(`SELECT status FROM ad_conversion_outbox WHERE id = ?`).get(id) as { status: string };
    expect(done.status).toBe('sent');
    expect(await claimAdConversionOutboxDue(db)).toHaveLength(0);
  });
});
