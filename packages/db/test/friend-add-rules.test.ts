import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  archiveFriendAddRule,
  createFriendAddRuleDraft,
  getFriendAddRule,
  listFriendAddRules,
  publishFriendAddRule,
  recordFriendAddRuleTest,
  saveFriendAddRuleDraft,
  type FriendAddRuleDefinition,
} from '../src/friend-add-rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const benign = /duplicate column name|already exists/i;

function execSafe(sqlite: Database.Database, sql: string): void {
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((value) => value.trim()).filter(Boolean)) {
    try { sqlite.exec(statement); } catch (error) {
      if (!benign.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  execSafe(sqlite, readFileSync(join(root, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    execSafe(sqlite, readFileSync(join(root, 'migrations', file), 'utf8'));
  }
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', 'Account 1', 'token', 'secret'),
            ('account-2', 'channel-2', 'Account 2', 'token', 'secret')`,
  ).run();
  return sqlite;
}

function asD1(sqlite: Database.Database): D1Database {
  const prepare = (query: string) => {
    const make = (params: unknown[]) => ({
      async run() {
        const info = sqlite.prepare(query).run(...params);
        return { results: [], success: true, meta: { changes: info.changes } };
      },
      async first<T>() { return (sqlite.prepare(query).get(...params) as T) ?? null; },
      async all<T>() { return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} }; },
    });
    return { bind: (...params: unknown[]) => make(params), ...make([]) };
  };
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      return sqlite.transaction(() => statements.map((statement) => (statement as unknown as { run(): Promise<unknown> }).run()))();
    },
  } as unknown as D1Database;
}

const definition: FriendAddRuleDefinition = {
  routeIds: ['route-1'],
  scenarioId: 'scenario-1',
  messageType: 'text',
  messageText: '友だち追加ありがとうございます。',
  timing: 'immediate',
  actions: [{ type: 'add_tag', targetId: 'tag-1', label: 'タグを付ける' }],
  friendCondition: '',
  activeFrom: null,
  activeUntil: null,
};

describe('friend add V6 rules', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => { sqlite = setup(); db = asD1(sqlite); });

  test('下書きの作成・更新・テスト・公開を固定版として残す', async () => {
    const created = await createFriendAddRuleDraft(db, {
      lineAccountId: 'account-1', friendKind: 'first_time', name: '店頭QRの初回案内',
      folderName: '店頭', priority: 1, definition, idempotencyKey: 'create-rule-000001',
    });
    expect(created.version_status).toBe('draft');
    const createReplay = await createFriendAddRuleDraft(db, {
      lineAccountId: 'account-1', friendKind: 'first_time', name: '二重作成されない',
      folderName: '店頭', priority: 1, definition, idempotencyKey: 'create-rule-000001',
    });
    expect(createReplay.id).toBe(created.id);

    const saved = await saveFriendAddRuleDraft(db, {
      lineAccountId: 'account-1', ruleId: created.id, name: '店頭QRの初回案内',
      folderName: '店頭', priority: 2, definition: { ...definition, messageText: '更新した案内' },
      idempotencyKey: 'save-rule-0000001',
    });
    expect(saved.priority).toBe(2);
    expect(JSON.parse(saved.definition_snapshot ?? '{}').messageText).toBe('更新した案内');
    const saveReplay = await saveFriendAddRuleDraft(db, {
      lineAccountId: 'account-1', ruleId: created.id, name: '再送で変わらない',
      folderName: null, priority: 99, definition: { ...definition, messageText: '再送の別内容' },
      idempotencyKey: 'save-rule-0000001',
    });
    expect(saveReplay.priority).toBe(2);
    expect(JSON.parse(saveReplay.definition_snapshot ?? '{}').messageText).toBe('更新した案内');

    await recordFriendAddRuleTest(db, {
      lineAccountId: 'account-1', ruleId: created.id, staffId: 'staff-1', succeeded: true,
    });
    const published = await publishFriendAddRule(db, {
      lineAccountId: 'account-1', ruleId: created.id, staffId: 'staff-1',
      idempotencyKey: 'publish-rule-0001',
    });
    expect(published.status).toBe('published');
    expect(published.version_status).toBe('published');

    const replay = await publishFriendAddRule(db, {
      lineAccountId: 'account-1', ruleId: created.id, staffId: 'staff-1',
      idempotencyKey: 'publish-rule-0001',
    });
    expect(replay.version_id).toBe(published.version_id);
  });

  test('アカウントと判定する人で一覧を分離する', async () => {
    await createFriendAddRuleDraft(db, {
      lineAccountId: 'account-1', friendKind: 'first_time', name: '初回', priority: 1, definition,
    });
    await createFriendAddRuleDraft(db, {
      lineAccountId: 'account-1', friendKind: 'returning', name: '再追加', priority: 1, definition,
    });
    await createFriendAddRuleDraft(db, {
      lineAccountId: 'account-2', friendKind: 'first_time', name: '別アカウント', priority: 1, definition,
    });
    const rows = await listFriendAddRules(db, { lineAccountId: 'account-1', friendKind: 'first_time' });
    expect(rows.map((row) => row.name)).toEqual(['初回']);
  });

  test('経路不明の受け皿は削除できず、通常ルールは履歴を残して一覧から外す', async () => {
    const normal = await createFriendAddRuleDraft(db, {
      lineAccountId: 'account-1', friendKind: 'first_time', name: '広告', priority: 1, definition,
    });
    await archiveFriendAddRule(db, { lineAccountId: 'account-1', ruleId: normal.id });
    expect(await getFriendAddRule(db, { lineAccountId: 'account-1', ruleId: normal.id })).toBeNull();

    sqlite.prepare(
      `INSERT INTO friend_add_rules
        (id, line_account_id, friend_kind, name, priority, is_unknown_route_fallback, status)
       VALUES ('fallback', 'account-1', 'first_time', '経路が分からなかった人', 9999, 1, 'published')`,
    ).run();
    await expect(archiveFriendAddRule(db, { lineAccountId: 'account-1', ruleId: 'fallback' }))
      .rejects.toThrow('FRIEND_ADD_RULE_NOT_ARCHIVED');
  });
});
