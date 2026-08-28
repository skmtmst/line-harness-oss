import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBroadcast, updateBroadcast } from '../src/broadcasts.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const info = stmt.run(...params);
              return { results: [], success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('createBroadcast', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    // bootstrap.sql = schema.sql + 全マイグレーション適用済みの現行スキーマ
    // (同期は bootstrap.test.ts が保証)。schema.sql + 手書き ALTER だと
    // message_bubbles_json のように後から入った列を取りこぼす。
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  test('persists a caller-supplied stable id and account fields atomically', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const result = await createBroadcast(db, {
      id,
      title: 'Personalized notice',
      messageType: 'text',
      messageContent: '{{name}}さんへ',
      targetType: 'all',
      scheduledAt: '2026-08-12T09:00:00.000+09:00',
      lineAccountId: 'account-1',
      altText: '通知',
    });

    expect(result.id).toBe(id);
    expect(result.status).toBe('scheduled');
    expect(result.line_account_id).toBe('account-1');
    expect(result.alt_text).toBe('通知');
  });

  test('the same stable id cannot create a second row', async () => {
    const input = {
      id: '11111111-2222-4333-8444-555555555555',
      title: 'Notice',
      messageType: 'text' as const,
      messageContent: 'hello',
      targetType: 'all' as const,
    };

    await createBroadcast(db, input);
    await expect(createBroadcast(db, input)).rejects.toThrow(/UNIQUE constraint failed/);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM broadcasts').get()).toEqual({ count: 1 });
  });

  test('test send draft can be updated in place without creating another row', async () => {
    const created = await createBroadcast(db, {
      title: 'テスト前',
      messageType: 'text',
      messageContent: '最初の本文',
      messageBubblesJson: JSON.stringify([{ id: 'b-1', type: 'text', content: { text: '最初の本文' } }]),
      targetType: 'all',
    });

    const updated = await updateBroadcast(db, created.id, {
      title: 'テスト後',
      message_content: '直した本文',
      message_bubbles_json: JSON.stringify([{ id: 'b-1', type: 'text', content: { text: '直した本文' } }]),
      target_type: 'segment',
      segment_conditions: JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] }),
      stealth_spread_minutes: 45,
    });

    expect(updated).toMatchObject({
      id: created.id,
      title: 'テスト後',
      message_content: '直した本文',
      target_type: 'segment',
      stealth_spread_minutes: 45,
    });
    expect(updated?.message_bubbles_json).toContain('直した本文');
    expect(updated?.segment_conditions).toContain('tag_exists');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM broadcasts').get()).toEqual({ count: 1 });
  });
});
