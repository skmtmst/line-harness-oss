import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveSupportMarkWithReplacement,
  getSupportMarkArchiveImpact,
  SupportMarkArchiveError,
} from '../src/support-marks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      async batch<T>(batchStatements: D1PreparedStatement[]) {
        return batchStatements as unknown as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  // better-sqlite3 には batch が無いため、文を順に実行する。
  const db = { prepare } as unknown as D1Database & {
    batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
  };
  db.batch = async (statements: D1PreparedStatement[]) => {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await (statement as unknown as { run(): Promise<unknown> }).run());
    }
    return results;
  };
  return db;
}

const scope = { tenantId: LEGACY_TENANT_ID, lineAccountId: 'account-1' };

/*
 * R180: 独自マーク1件・使用0人でも置換先なしで保管できる。
 * 以前は0人でも置換先が必須で、候補が空のときに保管できなかった。
 * 友だちがいる・参照がある・初期値・共有の保護は変えない。
 */
describe('R180 置換先なしの対応マーク保管', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO support_marks (id, name, is_default, display_order)
      VALUES ('mark-solo', '独自マーク', 0, 10),
             ('mark-other', 'もう1つの独自マーク', 0, 11);
      INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
      VALUES ('mark-solo', '${LEGACY_TENANT_ID}', 'account-1', '2026-09-27T00:00:00+09:00'),
             ('mark-other', '${LEGACY_TENANT_ID}', 'account-1', '2026-09-27T00:00:00+09:00');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  async function impactRevision(markId: string): Promise<{ revision: string; version: number }> {
    const impact = await getSupportMarkArchiveImpact(db, scope, markId);
    if (!impact || !impact.canArchive) throw new Error('保管できる想定のマークが保管不可になった');
    return { revision: impact.revision, version: Number(impact.mark.version ?? 1) };
  }

  it('0人なら置換先なしで保管できる', async () => {
    const { revision, version } = await impactRevision('mark-solo');
    const result = await archiveSupportMarkWithReplacement(db, scope, {
      markId: 'mark-solo',
      replacementMarkId: null,
      expectedVersion: version,
      impactRevision: revision,
      idempotencyKey: 'r180-solo',
      actorId: null,
    });
    expect(result.archived).toBe(true);
    expect(result.replacementMarkId).toBeNull();
    expect(result.replacedFriendCount).toBe(0);
    const row = sqlite.prepare('SELECT archived_at FROM support_marks WHERE id = ?').get('mark-solo') as { archived_at: string | null };
    expect(row.archived_at).not.toBeNull();
  });

  it('友だちがいるのに置換先なしは止める', async () => {
    sqlite.exec(`
      INSERT INTO friends (id, line_user_id, line_account_id, support_mark_id)
      VALUES ('friend-1', 'U1', 'account-1', 'mark-solo');
    `);
    const { revision, version } = await impactRevision('mark-solo');
    await expect(archiveSupportMarkWithReplacement(db, scope, {
      markId: 'mark-solo',
      replacementMarkId: null,
      expectedVersion: version,
      impactRevision: revision,
      idempotencyKey: 'r180-with-friend',
      actorId: null,
    })).rejects.toMatchObject({ code: 'replacement_invalid' });
    const row = sqlite.prepare('SELECT archived_at FROM support_marks WHERE id = ?').get('mark-solo') as { archived_at: string | null };
    expect(row.archived_at).toBeNull();
  });

  it('置換先ありの従来の保管はそのまま動く', async () => {
    sqlite.exec(`
      INSERT INTO friends (id, line_user_id, line_account_id, support_mark_id)
      VALUES ('friend-1', 'U1', 'account-1', 'mark-solo');
    `);
    const { revision, version } = await impactRevision('mark-solo');
    const result = await archiveSupportMarkWithReplacement(db, scope, {
      markId: 'mark-solo',
      replacementMarkId: 'mark-other',
      expectedVersion: version,
      impactRevision: revision,
      idempotencyKey: 'r180-with-replacement',
      actorId: null,
    });
    expect(result.archived).toBe(true);
    expect(result.replacementMarkId).toBe('mark-other');
    expect(result.replacedFriendCount).toBe(1);
    const friend = sqlite.prepare('SELECT support_mark_id FROM friends WHERE id = ?').get('friend-1') as { support_mark_id: string };
    expect(friend.support_mark_id).toBe('mark-other');
  });

  it('初期値のマークは置換先なしでも保管できない', async () => {
    sqlite.exec(`UPDATE support_marks SET is_default = 1 WHERE id = 'mark-solo'`);
    const impact = await getSupportMarkArchiveImpact(db, scope, 'mark-solo');
    expect(impact?.canArchive).toBe(false);
    await expect(archiveSupportMarkWithReplacement(db, scope, {
      markId: 'mark-solo',
      replacementMarkId: null,
      expectedVersion: 1,
      impactRevision: impact?.revision ?? '',
      idempotencyKey: 'r180-default',
      actorId: null,
    })).rejects.toMatchObject({ code: 'default_mark' });
  });
});
