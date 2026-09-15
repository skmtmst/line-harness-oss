import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  countMediaUsages,
  createTemplate,
  publishTemplate,
  saveTemplateDraft,
} from '../src/index.js';
import { asD1 } from './d1-test-helper.js';

const bootstrap = readFileSync(join(import.meta.dirname, '../bootstrap.sql'), 'utf8');

function setup(): { raw: Database.Database; db: D1Database } {
  const raw = new Database(':memory:');
  raw.exec(bootstrap);
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-1', 'c1', 'A1', 'token', 'secret'),
           ('account-2', 'c2', 'A2', 'token', 'secret');
    INSERT INTO media
      (id, line_account_id, kind, filename, mime_type, size_bytes, r2_key, created_at)
    VALUES ('media-a', 'account-1', 'image', 'a.png', 'image/png', 10,
            'media/account-1/a.png', '2026-09-16'),
           ('media-b', 'account-1', 'image', 'b.png', 'image/png', 10,
            'media/account-1/b.png', '2026-09-16'),
           ('media-c', 'account-1', 'image', 'c.png', 'image/png', 10,
            'media/account-1/c.png', '2026-09-16'),
           ('media-other', 'account-2', 'image', 'other.png', 'image/png', 10,
            'media/account-2/other.png', '2026-09-16');
  `);
  return { raw, db: asD1(raw) };
}

function imageBody(key: string): string {
  const url = `https://worker.example.com/images/${key}`;
  return JSON.stringify({ originalContentUrl: url, previewImageUrl: url });
}

describe('media usage とテンプレート保存の原子更新', () => {
  it('作成・更新・公開による参照解除を保存直後の台帳へ反映する', async () => {
    const { db } = setup();
    const created = await createTemplate(db, {
      name: '画像', category: 'general', messageType: 'image',
      messageContent: imageBody('media/account-1/a.png'), lineAccountId: 'account-1',
    });
    expect(await countMediaUsages(db, 'media-a')).toBe(1);

    await saveTemplateDraft(db, created.id, {
      messageType: 'image', messageContent: imageBody('media/account-1/b.png'),
    });
    // 下書き保存中は、現在の公開本文と次の公開候補の両方を保護する。
    expect(await countMediaUsages(db, 'media-a')).toBe(1);
    expect(await countMediaUsages(db, 'media-b')).toBe(1);

    await publishTemplate(db, created.id, {
      expectedVersion: 0, expectedDraftRevision: 2, idempotencyKey: 'media-publish-1',
    });
    expect(await countMediaUsages(db, 'media-a')).toBe(0);
    expect(await countMediaUsages(db, 'media-b')).toBe(1);

    await saveTemplateDraft(db, created.id, {
      messageType: 'image', messageContent: imageBody('external/not-library.png'),
    });
    expect(await countMediaUsages(db, 'media-b')).toBe(1);
    await publishTemplate(db, created.id, {
      expectedVersion: 1, expectedDraftRevision: 1, idempotencyKey: 'media-publish-2',
    });
    expect(await countMediaUsages(db, 'media-b')).toBe(0);
  });

  it('別accountのメディア参照はテンプレートも台帳も保存しない', async () => {
    const { raw, db } = setup();
    await expect(createTemplate(db, {
      name: '別account', category: 'general', messageType: 'image',
      messageContent: imageBody('media/account-2/other.png'), lineAccountId: 'account-1',
    })).rejects.toThrow('MEDIA_REFERENCE_ACCOUNT_MISMATCH');
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM templates`).get()).toEqual({ c: 0 });
    expect(await countMediaUsages(db, 'media-other')).toBe(0);
  });

  it('既存テンプレートの更新でも別account参照を0件にする', async () => {
    const { raw, db } = setup();
    const created = await createTemplate(db, {
      name: '画像', category: 'general', messageType: 'image',
      messageContent: imageBody('media/account-1/a.png'), lineAccountId: 'account-1',
    });

    await expect(saveTemplateDraft(db, created.id, {
      messageType: 'image', messageContent: imageBody('media/account-2/other.png'),
    })).rejects.toThrow('MEDIA_REFERENCE_ACCOUNT_MISMATCH');

    const row = raw.prepare(`
      SELECT draft_message_content, draft_revision FROM templates WHERE id = ?
    `).get(created.id) as { draft_message_content: string; draft_revision: number };
    expect(row.draft_message_content).toContain('media/account-1/a.png');
    expect(row.draft_revision).toBe(1);
    expect(await countMediaUsages(db, 'media-a')).toBe(1);
    expect(await countMediaUsages(db, 'media-other')).toBe(0);
  });

  it('台帳INSERTが失敗したら参照保存も0件へrollbackする', async () => {
    const { raw, db } = setup();
    raw.exec(`
      CREATE TRIGGER fail_media_usage_insert
      BEFORE INSERT ON media_usages
      BEGIN SELECT RAISE(ABORT, 'forced_media_usage_failure'); END;
    `);

    await expect(createTemplate(db, {
      name: '失敗', category: 'general', messageType: 'image',
      messageContent: imageBody('media/account-1/a.png'), lineAccountId: 'account-1',
    })).rejects.toThrow('forced_media_usage_failure');
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM templates`).get()).toEqual({ c: 0 });
    expect(await countMediaUsages(db, 'media-a')).toBe(0);
  });

  it('公開中の台帳INSERT失敗は本文・版・使用台帳を全て元に戻す', async () => {
    const { raw, db } = setup();
    const created = await createTemplate(db, {
      name: '画像', category: 'general', messageType: 'image',
      messageContent: imageBody('media/account-1/a.png'), lineAccountId: 'account-1',
    });
    await saveTemplateDraft(db, created.id, {
      messageType: 'image', messageContent: imageBody('media/account-1/b.png'),
    });
    raw.exec(`
      CREATE TRIGGER fail_media_usage_insert
      BEFORE INSERT ON media_usages
      BEGIN SELECT RAISE(ABORT, 'forced_media_usage_failure'); END;
    `);

    await expect(publishTemplate(db, created.id, {
      expectedVersion: 0, expectedDraftRevision: 2, idempotencyKey: 'failed-publish',
    })).rejects.toThrow('forced_media_usage_failure');

    const row = raw.prepare(`
      SELECT message_content, draft_message_content, published_version, draft_revision
      FROM templates WHERE id = ?
    `).get(created.id) as {
      message_content: string;
      draft_message_content: string;
      published_version: number;
      draft_revision: number;
    };
    expect(row.message_content).toContain('media/account-1/a.png');
    expect(row.draft_message_content).toContain('media/account-1/b.png');
    expect(row).toMatchObject({ published_version: 0, draft_revision: 2 });
    expect(await countMediaUsages(db, 'media-a')).toBe(1);
    expect(await countMediaUsages(db, 'media-b')).toBe(1);
  });

  it('同じ時刻に公開へ負けても勝者の使用台帳を上書きしない', async () => {
    const { raw, db } = setup();
    const created = await createTemplate(db, {
      name: '画像', category: 'general', messageType: 'image',
      messageContent: imageBody('media/account-1/a.png'), lineAccountId: 'account-1',
    });
    const baseDb = asD1(raw);
    const racingDb = {
      ...baseDb,
      prepare(query: string) {
        const statement = baseDb.prepare(query);
        if (!query.includes('published_version = published_version + 1')) return statement;
        return {
          ...statement,
          bind(...values: unknown[]) {
            // UPDATEのbind直後に、同じ時刻で別本文の公開が勝った状態を作る。
            // 時刻だけのguardでは、負けた側がこの台帳を旧本文へ戻してしまう。
            raw.transaction(() => {
              raw.prepare(`
                UPDATE templates
                   SET message_content = ?, draft_message_content = NULL,
                       draft_revision = 0, published_version = 1, updated_at = ?
                 WHERE id = ?
              `).run(imageBody('media/account-1/b.png'), values[0], created.id);
              raw.prepare(
                `DELETE FROM media_usages WHERE ref_kind = 'template' AND ref_id = ?`,
              ).run(created.id);
              raw.prepare(`
                INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
                VALUES ('media-b', 'template', ?, '2026-09-16')
              `).run(created.id);
            })();
            return statement.bind(...values);
          },
        } as D1PreparedStatement;
      },
    } as D1Database;

    await expect(publishTemplate(racingDb, created.id, {
      expectedVersion: 0, expectedDraftRevision: 1, idempotencyKey: 'loser',
    })).rejects.toThrow('TEMPLATE_VERSION_CONFLICT');
    expect(await countMediaUsages(db, 'media-a')).toBe(0);
    expect(await countMediaUsages(db, 'media-b')).toBe(1);
  });

  it('読取後に公開された下書き保存は競合になり、勝者の本文と台帳を変えない', async () => {
    const { raw, db } = setup();
    const created = await createTemplate(db, {
      name: '画像', category: 'general', messageType: 'image',
      messageContent: imageBody('media/account-1/a.png'), lineAccountId: 'account-1',
    });
    const baseDb = asD1(raw);
    let raced = false;
    const racingDb = {
      ...baseDb,
      prepare(query: string) {
        const statement = baseDb.prepare(query);
        if (!query.includes('draft_revision = draft_revision + 1')) return statement;
        return {
          ...statement,
          bind(...values: unknown[]) {
            if (!raced) {
              raced = true;
              raw.transaction(() => {
                raw.prepare(`
                  UPDATE templates
                     SET message_content = ?, draft_message_content = NULL,
                         draft_message_type = NULL, draft_revision = 0,
                         published_version = 1
                   WHERE id = ?
                `).run(imageBody('media/account-1/b.png'), created.id);
                raw.prepare(
                  `DELETE FROM media_usages WHERE ref_kind = 'template' AND ref_id = ?`,
                ).run(created.id);
                raw.prepare(`
                  INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
                  VALUES ('media-b', 'template', ?, '2026-09-16')
                `).run(created.id);
              })();
            }
            return statement.bind(...values);
          },
        } as D1PreparedStatement;
      },
    } as D1Database;

    await expect(saveTemplateDraft(racingDb, created.id, {
      messageType: 'image', messageContent: imageBody('media/account-1/c.png'),
    })).rejects.toThrow('TEMPLATE_DRAFT_CONFLICT');

    const row = raw.prepare(`
      SELECT message_content, draft_message_content, published_version, draft_revision
      FROM templates WHERE id = ?
    `).get(created.id) as {
      message_content: string;
      draft_message_content: string | null;
      published_version: number;
      draft_revision: number;
    };
    expect(row.message_content).toContain('media/account-1/b.png');
    expect(row).toMatchObject({
      draft_message_content: null, published_version: 1, draft_revision: 0,
    });
    expect(await countMediaUsages(db, 'media-a')).toBe(0);
    expect(await countMediaUsages(db, 'media-b')).toBe(1);
    expect(await countMediaUsages(db, 'media-c')).toBe(0);
  });
});
