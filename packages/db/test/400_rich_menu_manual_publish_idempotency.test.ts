import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRichMenuManualPublishRequestAtomic,
  getRichMenuManualPublishShells,
  claimRichMenuManualPublishRequest,
  markRichMenuManualPublishSucceeded,
  markRichMenuManualPublishFailed,
  recordRichMenuManualPublishShells,
} from '../src/rich-menu-manual-publish.js';

const ROOT = join(import.meta.dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const bound = (...params: unknown[]) => {
        const statement = sqlite.prepare(query);
        return {
          async run() { const meta = statement.run(...params); return { meta: { changes: meta.changes } }; },
          async first<T>() { return (statement.reader ? statement.get(...params) : null) as T | null; },
          async all<T>() { return { results: (statement.reader ? statement.all(...params) : []) as T[] }; },
        };
      };
      return {
        bind: (...params: unknown[]) => bound(...params),
        run: () => bound().run(), first: <T,>() => bound().first<T>(), all: <T,>() => bound().all<T>(),
      };
    },
    batch: async (statements: Array<{ run(): Promise<unknown> }>) => Promise.all(statements.map((statement) => statement.run())),
  } as unknown as D1Database;
}

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(`INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret) VALUES ('a1', 'a', 'c1', 't', 's'), ('a2', 'b', 'c2', 't', 's')`).run();
  sqlite.prepare(`INSERT INTO rich_menu_groups (id, account_id, name, status, size, chat_bar_text, is_default_for_all) VALUES ('g1', 'a1', 'g', 'draft', 'large', 'menu', 0), ('g2', 'a2', 'g', 'draft', 'large', 'menu', 0)`).run();
  return asD1(sqlite);
}

function input(key = 'key-1', fingerprint = 'v1', accountId = 'a1', groupId = 'g1') {
  return {
    id: `${accountId}-${key}-${fingerprint}`, accountId, groupId, idempotencyKey: key,
    definitionSnapshot: JSON.stringify({ version: fingerprint }), requestFingerprint: fingerprint,
    requestedByStaffId: 'staff-1', now: '2026-09-16T00:00:00.000Z',
  };
}

describe('400 rich menu manual publish idempotency', () => {
  it('401は400時点のrequest表へD1互換のALTERだけで実行できる', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE rich_menu_manual_publish_requests (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, account_id TEXT NOT NULL,
      definition_snapshot TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT,
      last_error_code TEXT, requested_by_staff_id TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    sqlite.exec(readFileSync(join(ROOT, 'migrations/401_rich_menu_manual_publish_execution_token.sql'), 'utf8'));
    const columns = sqlite.prepare('PRAGMA table_info(rich_menu_manual_publish_requests)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('execution_token');
    sqlite.close();
  });

  it('同key同版の同時要求は1件だけ作り、成功結果は同じrequestから再生できる', async () => {
    const db = setup();
    const [first, second] = await Promise.all([
      createRichMenuManualPublishRequestAtomic(db, input()),
      createRichMenuManualPublishRequestAtomic(db, input()),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(['created', 'existing']);
    const requestId = first.request.id;
    await recordRichMenuManualPublishShells(db, requestId, [{ pageId: 'p1', orderIndex: 0, newRichMenuId: 'line-new-1', oldRichMenuId: 'line-old-1' }]);
    expect(await claimRichMenuManualPublishRequest(db, requestId, 'attempt-1')).toBe(true);
    expect(await markRichMenuManualPublishSucceeded(db, requestId, 'attempt-1', JSON.stringify({ pages: [{ pageId: 'p1', newRichMenuId: 'line-new-1' }] }))).toBe(true);
    const replay = await createRichMenuManualPublishRequestAtomic(db, input());
    expect(replay.outcome).toBe('existing');
    expect(replay.request.status).toBe('succeeded');
    await expect(getRichMenuManualPublishShells(db, requestId)).resolves.toMatchObject([
      { new_richmenu_id: 'line-new-1', old_richmenu_id: 'line-old-1' },
    ]);
  });

  it('同keyの別版は409用conflict、別accountは独立したrequestになる', async () => {
    const db = setup();
    await createRichMenuManualPublishRequestAtomic(db, input());
    await expect(createRichMenuManualPublishRequestAtomic(db, input('key-1', 'v2'))).resolves.toMatchObject({ outcome: 'conflict' });
    await expect(createRichMenuManualPublishRequestAtomic(db, input('key-1', 'v1', 'a2', 'g2'))).resolves.toMatchObject({ outcome: 'created' });
  });

  it('古い実行世代は新しい世代の成功をfailedへ戻せない', async () => {
    const db = setup();
    const created = await createRichMenuManualPublishRequestAtomic(db, input());
    expect(await claimRichMenuManualPublishRequest(db, created.request.id, 'old-holder')).toBe(true);
    // lease切替後の実行者が同じrunning行を新世代として取得する。
    expect(await claimRichMenuManualPublishRequest(db, created.request.id, 'new-holder')).toBe(true);
    expect(await markRichMenuManualPublishSucceeded(db, created.request.id, 'new-holder', JSON.stringify({ pages: [] }))).toBe(true);
    expect(await markRichMenuManualPublishFailed(db, created.request.id, 'old-holder', 'stale failure')).toBe(false);
    const replay = await createRichMenuManualPublishRequestAtomic(db, input());
    expect(replay.request.status).toBe('succeeded');
  });

  it('別keyへleaseが移った古い実行は、自分のrequestを成功にできない', async () => {
    const db = setup();
    const created = await createRichMenuManualPublishRequestAtomic(db, input('old-key'));
    expect(await claimRichMenuManualPublishRequest(db, created.request.id, 'old-holder')).toBe(true);
    const now = '2026-09-16T00:00:00.000Z';
    // owner/generation は新しい別keyの実行者へ移った。old-holderのrequestにtokenが
    // 残っていても、group fenceを満たさなければ成功として固定できない。
    await db.prepare(
      `UPDATE rich_menu_groups
          SET publishing_owner = ?, publishing_generation = ?, publishing_expires_at = ?
        WHERE id = ?`,
    ).bind('manual-new-request', 2, '2026-09-16T00:10:00.000Z', 'g1').run();
    expect(await markRichMenuManualPublishSucceeded(
      db,
      created.request.id,
      'old-holder',
      JSON.stringify({ pages: [] }),
      { groupId: 'g1', owner: 'manual-old-request', generation: 1, nowIso: now },
    )).toBe(false);
    const replay = await createRichMenuManualPublishRequestAtomic(db, input('old-key'));
    expect(replay.request.status).toBe('running');
  });
});
