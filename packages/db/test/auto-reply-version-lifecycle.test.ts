import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAutoReplyWithDraftVersion,
  ensureAutoReplyPublishedVersion,
  getAutoReplyDraftVersion,
  getAutoReplyPublishedVersion,
  parseAutoReplyVersionSettings,
  publishAutoReplyDraftVersion,
  recordAutoReplyDraftTest,
  saveAutoReplyDraftVersion,
  type AutoReplyDraftSettings,
} from '../src/auto-reply-runs.js';
import { getAutoReplyById } from '../src/auto-replies.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const make = (params: unknown[]) => ({
      bind: (...next: unknown[]) => make(next),
      async run() {
        const result = sqlite.prepare(query).run(...params);
        return { success: true, results: [], meta: { changes: result.changes } };
      },
      async first<T>() {
        return (sqlite.prepare(query).get(...params) as T) ?? null;
      },
      async all<T>() {
        return { success: true, results: sqlite.prepare(query).all(...params) as T[], meta: {} };
      },
    }) as unknown as D1PreparedStatement;
    return make([]);
  }
  const db = {
    prepare,
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const run = sqlite.transaction(() => statements.map((statement) => statement.run()));
      return Promise.all(run()) as Promise<T[]>;
    },
  };
  return db as unknown as D1Database;
}

function settings(overrides: Partial<AutoReplyDraftSettings> = {}): AutoReplyDraftSettings {
  return {
    keyword: '予約',
    matchType: 'contains',
    responseType: 'text',
    responseContent: 'ご予約を承ります',
    templateId: null,
    lineAccountId: 'account-a',
    activeFrom: null,
    activeUntil: null,
    cooldownMinutes: null,
    skipWhenOperatorActive: true,
    priority: 10,
    messageKinds: JSON.stringify(['text']),
    friendConditions: null,
    actions: null,
    responseWeekdays: null,
    responseHolidayRule: null,
    oncePerFriend: false,
    keywords: null,
    respondToAll: false,
    name: '予約問い合わせ',
    keywordMatchMode: 'any',
    folderId: null,
    ...overrides,
  };
}

describe('自動応答の下書き・試験・公開版', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('新規下書きは自動応答を動かさず、公開版も作らない', async () => {
    const created = await createAutoReplyWithDraftVersion(db, settings());
    expect(created.rule.is_active).toBe(0);
    expect(created.version.status).toBe('draft');
    expect(await getAutoReplyPublishedVersion(db, created.rule.id)).toBeNull();
    expect(parseAutoReplyVersionSettings(created.version).name).toBe('予約問い合わせ');
  });

  it('公開中の定義を変えず、次の版だけを下書きとして保存する', async () => {
    const created = await createAutoReplyWithDraftVersion(db, settings());
    await recordAutoReplyDraftTest(db, created.version.id, { succeeded: true, staffId: 'staff-1' });
    await publishAutoReplyDraftVersion(db, created.rule.id, {
      staffId: 'staff-1',
      idempotencyKey: 'publish-first',
    });

    const draft = await saveAutoReplyDraftVersion(
      db,
      created.rule.id,
      settings({ responseContent: '新しい返事です' }),
    );
    expect(draft.version_number).toBe(2);
    expect(draft.last_test_status).toBeNull();
    expect((await getAutoReplyById(db, created.rule.id))?.response_content).toBe('ご予約を承ります');
    expect((await getAutoReplyPublishedVersion(db, created.rule.id))?.version_number).toBe(1);
  });

  it('試験に通っていない下書きは公開せず、同じキーの再実行は同じ版を返す', async () => {
    const created = await createAutoReplyWithDraftVersion(db, settings());
    await expect(publishAutoReplyDraftVersion(db, created.rule.id, {
      staffId: 'staff-1',
      idempotencyKey: 'publish-once',
    })).rejects.toThrow('AUTO_REPLY_DRAFT_NOT_TESTED');

    await recordAutoReplyDraftTest(db, created.version.id, { succeeded: true, staffId: 'staff-1' });
    const first = await publishAutoReplyDraftVersion(db, created.rule.id, {
      staffId: 'staff-1',
      idempotencyKey: 'publish-once',
    });
    const replay = await publishAutoReplyDraftVersion(db, created.rule.id, {
      staffId: 'staff-1',
      idempotencyKey: 'publish-once',
    });
    expect(replay.id).toBe(first.id);
    expect((await getAutoReplyById(db, created.rule.id))?.is_active).toBe(1);
    expect(await getAutoReplyDraftVersion(db, created.rule.id)).toBeNull();
  });

  it('公開版は書き換えられず、実行時も同じ版を使う', async () => {
    const created = await createAutoReplyWithDraftVersion(db, settings());
    await recordAutoReplyDraftTest(db, created.version.id, { succeeded: true, staffId: 'staff-1' });
    const published = await publishAutoReplyDraftVersion(db, created.rule.id, {
      staffId: 'staff-1',
      idempotencyKey: 'publish-fixed',
    });
    const rule = await getAutoReplyById(db, created.rule.id);
    expect(rule).not.toBeNull();
    expect((await ensureAutoReplyPublishedVersion(db, rule!)).id).toBe(published.id);
    expect(() => sqlite.prepare(
      `UPDATE auto_reply_versions SET definition_snapshot = '{}' WHERE id = ?`,
    ).run(published.id)).toThrow('published auto reply versions are immutable');
  });
});
