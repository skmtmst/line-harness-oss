import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scanMediaUsage, scanSingleMediaUsage } from './media-usage-scan.js';

function asD1(sqlite: Database.Database): D1Database {
  const d1 = {
    prepare(query: string) {
      const prepared = () => sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const result = prepared().run(...params);
              return { success: true, results: [], meta: { changes: result.changes } };
            },
            async first<T>() {
              return (prepared().get(...params) as T) ?? null;
            },
            async all<T>() {
              return { success: true, results: prepared().all(...params) as T[], meta: {} };
            },
          };
        },
      };
    },
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return d1 as unknown as D1Database;
}

describe('登録メディアの厳密走査と実DBスキーマ', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'),
      'utf8',
    ));
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_secret, channel_access_token, created_at, updated_at)
       VALUES ('account-1', 'channel-1', 'Account 1', 'secret', 'token',
               '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO media
         (id, line_account_id, kind, filename, mime_type, size_bytes, r2_key, created_at)
       VALUES ('media-1', 'account-1', 'image', '案内.png', 'image/png', 100,
               'media/guide.png', '2026-08-31T10:00:00.000')`,
    ).run();
    db = asD1(sqlite);
  });

  it('現行列だけを読み、複数吹き出しと画像列の参照を落とさない', async () => {
    const mediaUrl = 'https://example.com/images/media/guide.png';
    sqlite.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, line_account_id, message_bubbles_json)
       VALUES ('broadcast-1', 'お知らせ', 'text', '本文', 'account-1', ?)`,
    ).run(JSON.stringify([{ type: 'image', originalContentUrl: mediaUrl }]));
    sqlite.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, line_account_id)
       VALUES ('scenario-1', '来店後', 'manual', 'account-1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO scenario_steps
         (id, scenario_id, step_order, message_type, message_content, message_bubbles_json)
       VALUES ('step-1', 'scenario-1', 0, 'text', '本文', ?)`,
    ).run(JSON.stringify([{ type: 'image', originalContentUrl: mediaUrl }]));
    sqlite.prepare(
      `INSERT INTO nen_columns
         (id, slug, title, article_url, image_url, line_account_id, created_at, updated_at)
       VALUES ('column-1', 'care', '夏のケア', 'https://example.com/care', ?, 'account-1',
               '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
    ).run(mediaUrl);
    sqlite.prepare(
      `INSERT INTO webinars
         (id, account_id, title, slug, status, video_prefix, created_at, updated_at)
       VALUES ('webinar-1', 'account-1', '使い方講座', 'guide', 'draft', ?,
               '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
    ).run('media/guide.png');

    const result = await scanSingleMediaUsage(
      db,
      '2026-08-30T10:00:00.000+09:00',
      { id: 'media-1', r2_key: 'media/guide.png' },
    );

    expect(result).toMatchObject({ scanned: 1, matched: 4 });
    expect(sqlite.prepare(
      `SELECT ref_kind, ref_id FROM media_usages WHERE media_id = 'media-1'
       ORDER BY ref_kind, ref_id`,
    ).all()).toEqual([
      { ref_kind: 'broadcast', ref_id: 'broadcast-1' },
      { ref_kind: 'nen_column', ref_id: 'column-1' },
      { ref_kind: 'scenario_step', ref_id: 'step-1' },
      { ref_kind: 'webinar', ref_id: 'webinar-1' },
    ]);
  });

  it('削除直前は200件を超える使用先も全件数える', async () => {
    const insert = sqlite.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, line_account_id)
       VALUES (?, ?, 'image', ?, 'account-1')`,
    );
    for (let index = 0; index < 205; index += 1) {
      insert.run(`broadcast-${index}`, `お知らせ${index}`, 'https://example.com/images/media/guide.png');
    }

    const result = await scanSingleMediaUsage(
      db,
      '2026-08-30T10:00:00.000+09:00',
      { id: 'media-1', r2_key: 'media/guide.png' },
    );

    expect(result).toMatchObject({ scanned: 1, matched: 205 });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM media_usages WHERE media_id = 'media-1'`,
    ).get()).toEqual({ count: 205 });
  });

  it('定期走査は7回へ分け、1周が終わるまで古い記録を消さない', async () => {
    sqlite.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
       VALUES ('template-1', '案内', 'image', 'https://example.com/media/guide.png', 'account-1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
       VALUES ('media-1', 'event', 'deleted-event', '2026-08-01T00:00:00.000')`,
    ).run();

    for (let index = 0; index < 6; index += 1) {
      const result = await scanMediaUsage(db, `2026-09-0${index + 1}T00:00:00.000`);
      expect(result.cycleCompleted).toBe(false);
    }
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM media_usages WHERE ref_id = 'deleted-event'`,
    ).get()).toEqual({ count: 1 });

    const queued = await scanMediaUsage(db, '2026-09-07T00:00:00.000');
    expect(queued).toMatchObject({ source: 'webinar', cycleCompleted: false, pruned: 0 });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM media_usages WHERE ref_id = 'deleted-event'`,
    ).get()).toEqual({ count: 1 });

    const completed = await scanMediaUsage(db, '2026-09-08T00:00:00.000');

    expect(completed).toMatchObject({ cycleCompleted: true, pruned: 1 });
    expect(sqlite.prepare(
      `SELECT ref_kind, ref_id FROM media_usages ORDER BY ref_kind, ref_id`,
    ).all()).toEqual([{ ref_kind: 'template', ref_id: 'template-1' }]);
    expect(sqlite.prepare(
      `SELECT source_index, last_ref_id, cycle_started_at FROM media_usage_scan_state WHERE id = 1`,
    ).get()).toEqual({
      source_index: 0,
      last_ref_id: '',
      cycle_started_at: '2026-09-08T00:00:00.000',
    });
  });
});
