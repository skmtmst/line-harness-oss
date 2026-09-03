import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyMediaReplacementPlan,
  getMediaDeleteImpact,
  getMediaReplacementPlan,
} from '../src/media.js';

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
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
  return d1;
}

function insertAccount(sqlite: Database.Database, id: string) {
  sqlite.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_secret, channel_access_token, created_at, updated_at)
     VALUES (?, ?, ?, 'secret', 'token', '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
  ).run(id, `channel-${id}`, `Account ${id}`);
}

function insertUsage(sqlite: Database.Database, kind: string, id: string) {
  sqlite.prepare(
    `INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
     VALUES ('media-1', ?, ?, '2026-08-31T10:00:00.000')`,
  ).run(kind, id);
}

describe('getMediaDeleteImpact', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite, 'account-1');
    insertAccount(sqlite, 'account-2');
    sqlite.prepare(
      `INSERT INTO media
         (id, line_account_id, kind, filename, mime_type, size_bytes, r2_key, created_at)
       VALUES ('media-1', 'account-1', 'image', '案内.png', 'image/png', 100,
               'media/guide.png', '2026-08-31T09:00:00.000'),
              ('media-2', 'account-1', 'image', '新案内.png', 'image/png', 100,
               'media/new-guide.png', '2026-08-31T09:01:00.000'),
              ('media-video', 'account-1', 'video', '動画.mp4', 'video/mp4', 100,
               'media/movie.mp4', '2026-08-31T09:02:00.000')`,
    ).run();
    db = asD1(sqlite);
  });

  test('使用先が0件と確定したときだけ削除できる', async () => {
    const impact = await getMediaDeleteImpact(
      db, 'media-1', 'account-1', '2026-08-31T10:00:00.000',
    );

    expect(impact).toEqual({
      media: { id: 'media-1', filename: '案内.png', kind: 'image' },
      usageCount: 0,
      references: [],
      checkedAt: '2026-08-31T10:00:00.000',
      lastScannedAt: null,
      canDelete: true,
      recommendedAction: 'delete',
    });
  });

  test('7種類の使用先を運用者向けの名前と導線へ変える', async () => {
    sqlite.prepare(
      `INSERT INTO templates
         (id, name, message_type, message_content, line_account_id)
       VALUES ('template-1', '来店後テンプレート', 'image', '{}', 'account-1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, line_account_id)
       VALUES ('broadcast-1', '8月のお知らせ', 'image', '{}', 'account-1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO rich_menu_groups
         (id, account_id, name, chat_bar_text, size)
       VALUES ('menu-1', 'account-1', '通常メニュー', 'メニュー', 'large')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO rich_menu_pages
         (id, group_id, order_index, name, alias_id)
       VALUES ('menu-page-1', 'menu-1', 0, 'ホーム', 'alias-home')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO scenarios
         (id, name, trigger_type, line_account_id)
       VALUES ('scenario-1', '来店後シナリオ', 'manual', 'account-1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO scenario_steps
         (id, scenario_id, step_order, message_type, message_content)
       VALUES ('step-1', 'scenario-1', 0, 'image', '{}')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO nen_columns
         (id, slug, title, article_url, line_account_id, created_at, updated_at)
       VALUES ('column-1', 'care', '夏のケア', 'https://example.com/care', 'account-1',
               '2026-08-31T09:00:00.000', '2026-08-31T09:00:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO events (id, line_account_id, name)
       VALUES ('event-1', 'account-1', '相談会')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO webinars
         (id, account_id, title, slug, created_at, updated_at)
       VALUES ('webinar-1', 'account-1', '使い方講座', 'guide',
               '2026-08-31T09:00:00.000', '2026-08-31T09:00:00.000')`,
    ).run();

    insertUsage(sqlite, 'template', 'template-1');
    insertUsage(sqlite, 'broadcast', 'broadcast-1');
    insertUsage(sqlite, 'rich_menu', 'menu-page-1');
    insertUsage(sqlite, 'scenario_step', 'step-1');
    insertUsage(sqlite, 'nen_column', 'column-1');
    insertUsage(sqlite, 'event', 'event-1');
    insertUsage(sqlite, 'webinar', 'webinar-1');

    const impact = await getMediaDeleteImpact(
      db, 'media-1', 'account-1', '2026-08-31T10:00:00.000',
    );

    expect(impact?.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'template', name: '来店後テンプレート', href: '/templates/edit?id=template-1' }),
      expect.objectContaining({ kind: 'broadcast', name: '8月のお知らせ', href: '/broadcasts/detail?id=broadcast-1' }),
      expect.objectContaining({ kind: 'rich_menu', name: '通常メニュー・ホーム', href: '/rich-menus/edit?id=menu-1' }),
      expect.objectContaining({ kind: 'scenario_step', name: '来店後シナリオ・1通目', href: '/scenarios/detail?id=scenario-1' }),
      expect.objectContaining({ kind: 'nen_column', name: '夏のケア', href: '/nen-campaigns?tab=columns' }),
      expect.objectContaining({ kind: 'event', name: '相談会', href: '/events/edit?id=event-1' }),
      expect.objectContaining({ kind: 'webinar', name: '使い方講座', href: '/webinars/edit?id=webinar-1' }),
    ]));
    expect(impact).toMatchObject({
      usageCount: 7,
      lastScannedAt: '2026-08-31T10:00:00.000',
      canDelete: false,
      recommendedAction: 'review_references',
    });
  });

  test('別アカウントと削除済みの使用先は名前を漏らさず削除を止める', async () => {
    sqlite.prepare(
      `INSERT INTO templates
         (id, name, message_type, message_content, line_account_id)
       VALUES ('other-template', '別店舗だけの名前', 'image', '{}', 'account-2')`,
    ).run();
    insertUsage(sqlite, 'template', 'other-template');
    insertUsage(sqlite, 'event', 'already-removed');

    const impact = await getMediaDeleteImpact(
      db, 'media-1', 'account-1', '2026-08-31T10:00:00.000',
    );

    expect(impact?.references).toEqual([
      expect.objectContaining({ kind: 'event', name: null, href: null, state: 'unavailable' }),
      expect.objectContaining({ kind: 'template', name: null, href: null, state: 'unavailable' }),
    ]);
    expect(JSON.stringify(impact)).not.toContain('別店舗だけの名前');
    expect(impact?.canDelete).toBe(false);
  });

  test('別アカウントからはメディアの存在を返さない', async () => {
    await expect(
      getMediaDeleteImpact(db, 'media-1', 'account-2', '2026-08-31T10:00:00.000'),
    ).resolves.toBeNull();
  });

  test('同じアカウント・同じ種類の使用先だけを差し替えられる', async () => {
    sqlite.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
       VALUES ('template-1', '案内', 'image', '{"url":"media/guide.png"}', 'account-1')`,
    ).run();
    insertUsage(sqlite, 'template', 'template-1');
    const plan = await getMediaReplacementPlan(db, {
      sourceId: 'media-1', replacementId: 'media-2', lineAccountId: 'account-1',
      checkedAt: '2026-08-31T10:00:00.000',
    });
    expect(plan?.impact).toMatchObject({
      usageCount: 1,
      replaceableCount: 1,
      blockers: [],
      canReplace: true,
    });
    const changes = await applyMediaReplacementPlan(db, plan!, 'account-1');
    expect(changes).toBe(1);
    expect(sqlite.prepare(`SELECT message_content FROM templates WHERE id = 'template-1'`).get())
      .toEqual({ message_content: '{"url":"media/new-guide.png"}' });
    expect(sqlite.prepare(`SELECT media_id FROM media_usages`).all())
      .toEqual([{ media_id: 'media-2' }]);
  });

  test('別種類・複数アカウント共有・ウェビナー動画は一括差し替えを止める', async () => {
    sqlite.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, line_account_id, account_ids)
       VALUES ('broadcast-1', '共有配信', 'image', 'media/guide.png', 'account-1',
               '["account-1","account-2"]')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO webinars (id, account_id, title, slug, video_prefix, created_at, updated_at)
       VALUES ('webinar-1', 'account-1', '講座', 'guide', 'media/guide.png',
               '2026-08-31T09:00:00.000', '2026-08-31T09:00:00.000')`,
    ).run();
    insertUsage(sqlite, 'broadcast', 'broadcast-1');
    insertUsage(sqlite, 'webinar', 'webinar-1');

    const sharedPlan = await getMediaReplacementPlan(db, {
      sourceId: 'media-1', replacementId: 'media-2', lineAccountId: 'account-1',
      checkedAt: '2026-08-31T10:00:00.000',
    });
    expect(sharedPlan?.impact).toMatchObject({
      canReplace: false,
      blockers: expect.arrayContaining(['shared_reference', 'unsupported_reference']),
    });
    await expect(applyMediaReplacementPlan(db, sharedPlan!, 'account-1'))
      .rejects.toThrow('media_replacement_blocked');

    const kindPlan = await getMediaReplacementPlan(db, {
      sourceId: 'media-1', replacementId: 'media-video', lineAccountId: 'account-1',
      checkedAt: '2026-08-31T10:00:00.000',
    });
    expect(kindPlan?.impact.blockers).toContain('different_kind');
  });
});
