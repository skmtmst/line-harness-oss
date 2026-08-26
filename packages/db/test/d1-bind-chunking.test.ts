import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { countFunnelStep, type FunnelStep } from '../src/funnels.js';
import { pruneStaleMediaUsages } from '../src/media.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

describe('D1 bind上限を超える対象の分割', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('ファネルの150人を全件照合し、分割しないSQLiteの結果と一致する', async () => {
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', '本店', 'token', 'secret')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tags (id, name, line_account_id)
       VALUES ('tag-1', '申込済み', 'account-1')`,
    ).run();
    const insertFriend = sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id) VALUES (?, ?, 'account-1')`,
    );
    const insertTag = sqlite.prepare(
      `INSERT INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, 'tag-1', '2026-08-01T00:00:00.000Z')`,
    );
    sqlite.transaction(() => {
      for (let index = 0; index < 160; index++) {
        const friendId = `friend-${index}`;
        insertFriend.run(friendId, `U${index}`);
        insertTag.run(friendId);
      }
    })();

    const scopedIds = Array.from({ length: 150 }, (_, index) => `friend-${index}`);
    const placeholders = scopedIds.map(() => '?').join(',');
    const expected = sqlite.prepare(
      `SELECT DISTINCT friend_id FROM friend_tags
       WHERE tag_id = 'tag-1' AND assigned_at >= ? AND assigned_at <= ?
         AND friend_id IN (${placeholders})`,
    ).all('2026-08-01T00:00:00.000Z', '2026-08-31T23:59:59.999Z', ...scopedIds)
      .map((row) => (row as { friend_id: string }).friend_id);
    const step: FunnelStep = {
      id: 'step-1', funnel_id: 'funnel-1', step_order: 1,
      label: 'タグ', kind: 'tag', match_json: JSON.stringify({ tagId: 'tag-1' }),
    };
    const opts = {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      lineAccountId: 'account-1',
    };

    const actual = await countFunnelStep(db, step, {
      ...opts,
      friendIds: [...scopedIds, 'friend-0'],
    });

    expect(new Set(actual)).toEqual(new Set(expected));
    expect(actual).toHaveLength(150);
    await expect(countFunnelStep(db, step, opts)).resolves.toHaveLength(160);
    await expect(countFunnelStep(db, step, { ...opts, friendIds: [] })).resolves.toHaveLength(160);
  });

  it('150件の古いメディア使用記録をすべて消し、削除件数を合計する', async () => {
    const insertMedia = sqlite.prepare(
      `INSERT INTO media (id, kind, filename, mime_type, size_bytes, r2_key)
       VALUES (?, 'image', ?, 'image/png', 1, ?)`,
    );
    const insertUsage = sqlite.prepare(
      `INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
       VALUES (?, 'template', ?, ?)`,
    );
    const mediaIds = Array.from({ length: 150 }, (_, index) => `media-${index}`);
    sqlite.transaction(() => {
      for (const mediaId of mediaIds) {
        insertMedia.run(mediaId, `${mediaId}.png`, `uploads/${mediaId}.png`);
        insertUsage.run(mediaId, `template-${mediaId}`, '2026-08-01T00:00:00.000Z');
      }
      insertUsage.run('media-0', 'template-fresh', '2026-08-03T00:00:00.000Z');
    })();

    const changes = await pruneStaleMediaUsages(db, '2026-08-02T00:00:00.000Z', mediaIds);

    expect(changes).toBe(150);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM media_usages`).get())
      .toEqual({ count: 1 });
  });
});
