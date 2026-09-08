import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createTemplate,
  getTemplateById,
  hasTemplateDraft,
  publishTemplate,
  saveTemplateDraft,
  type TemplateRow,
} from '../src/templates.js';
import { asD1 } from './d1-test-helper.js';

const packageRoot = join(import.meta.dirname, '..');
const migration347 = readFileSync(
  join(packageRoot, 'migrations', '347_template_published_version.sql'),
  'utf8',
);

/** bootstrap.sql は schema.sql + 全マイグレーション適用済みの現行スキーマ。 */
function openMigratedDb(): D1Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
  return asD1(sqlite);
}

function createLiveTemplate(db: D1Database, messageContent = '公開中の本文') {
  return createTemplate(db, { name: 'あいさつ', messageType: 'text', messageContent });
}

describe('migration 347 テンプレートの公開版固定(#645 / N-131)', () => {
  it('作った直後は公開版として読める(送信側が読む live 列に入る)', async () => {
    const db = openMigratedDb();
    const created = await createLiveTemplate(db);

    expect(created.published_version).toBe(1);
    expect(created.published_at).not.toBeNull();
    expect(hasTemplateDraft(created)).toBe(false);
    // 送信側(auto_reply / step_delivery / event_bus / reminder_delivery)は
    // getTemplateById の live 列を読む。作った直後から読める。
    const live = await getTemplateById(db, created.id);
    expect(live?.message_content).toBe('公開中の本文');
  });

  it('下書き保存だけでは公開版が変わらず、2回目の保存が残る', async () => {
    const db = openMigratedDb();
    const created = await createLiveTemplate(db);

    await saveTemplateDraft(db, created.id, { messageContent: '1回目の編集' });
    await saveTemplateDraft(db, created.id, { messageContent: '2回目の編集' });

    const row = (await getTemplateById(db, created.id))!;
    // 公開版は不変。
    expect(row.message_content).toBe('公開中の本文');
    expect(row.published_version).toBe(1);
    // 下書きには2回目の内容が残る。
    expect(row.draft_message_content).toBe('2回目の編集');
    expect(row.draft_message_type).toBe('text');
    expect(hasTemplateDraft(row)).toBe(true);
  });

  it('公開すると下書きが公開版になり、版が1つ進んで下書きが消える', async () => {
    const db = openMigratedDb();
    const created = await createLiveTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '公開したい本文' });

    const result = await publishTemplate(db, created.id, {
      expectedVersion: 1,
      idempotencyKey: 'publish-key-0001',
    });

    expect(result.published).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.row.message_content).toBe('公開したい本文');
    expect(result.row.published_version).toBe(2);
    expect(hasTemplateDraft(result.row)).toBe(false);
  });

  it('下書きがない公開は何もせず成功する(再試行は何度でも同じ)', async () => {
    const db = openMigratedDb();
    const created = await createLiveTemplate(db);

    const first = await publishTemplate(db, created.id, { idempotencyKey: 'retry-key-0002' });
    expect(first.published).toBe(false);
    expect(first.row.published_version).toBe(1);

    const second = await publishTemplate(db, created.id, { idempotencyKey: 'retry-key-0002' });
    expect(second.published).toBe(false);
    expect(second.row.published_version).toBe(1);
  });

  it('同じ確認キーでの再試行は公開済みの結果をそのまま返す', async () => {
    const db = openMigratedDb();
    const created = await createLiveTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '公開したい本文' });

    await publishTemplate(db, created.id, { idempotencyKey: 'publish-key-0003' });
    const replay = await publishTemplate(db, created.id, { idempotencyKey: 'publish-key-0003' });

    expect(replay.published).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.row.message_content).toBe('公開したい本文');
    expect(replay.row.published_version).toBe(2);
  });

  it('公開済みの確認キーを新しい下書きに使い回すと断る', async () => {
    const db = openMigratedDb();
    const created = await createLiveTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '公開したい本文' });
    await publishTemplate(db, created.id, { idempotencyKey: 'publish-key-0004' });

    await saveTemplateDraft(db, created.id, { messageContent: '次の編集' });
    await expect(
      publishTemplate(db, created.id, { idempotencyKey: 'publish-key-0004' }),
    ).rejects.toThrow('TEMPLATE_PUBLISH_KEY_CONFLICT');
  });

  it('古い版番号での公開は同時更新の負けとして断る', async () => {
    const db = openMigratedDb();
    const created = await createLiveTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '先に勝った公開' });
    await publishTemplate(db, created.id, { expectedVersion: 1 });

    // 版は2へ進んだ。古い版1を指定した同時更新は通さない。
    await saveTemplateDraft(db, created.id, { messageContent: '遅れてきた公開' });
    await expect(
      publishTemplate(db, created.id, { expectedVersion: 1 }),
    ).rejects.toThrow('TEMPLATE_VERSION_CONFLICT');

    const row = (await getTemplateById(db, created.id))!;
    expect(row.message_content).toBe('先に勝った公開');
    expect(row.published_version).toBe(2);
  });

  it('ないテンプレートの下書き保存・公開は見つからないと返す', async () => {
    const db = openMigratedDb();
    await expect(saveTemplateDraft(db, 'tpl-ない', { messageContent: 'x' })).rejects.toThrow(
      'TEMPLATE_NOT_FOUND',
    );
    await expect(publishTemplate(db, 'tpl-ない')).rejects.toThrow('TEMPLATE_NOT_FOUND');
  });

  it('347 適用前の行は公開済みになり、参照先なしを作らない', () => {
    const sqlite = new Database(':memory:');
    // 347 より前の templates の形だけ作る。
    sqlite.exec(`
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        message_type TEXT NOT NULL,
        message_content TEXT NOT NULL,
        carousel_actions_json TEXT,
        carousel_tap_limit_mode TEXT NOT NULL DEFAULT 'none',
        carousel_tap_limit_text TEXT,
        question_json TEXT,
        question_status TEXT NOT NULL DEFAULT 'published',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        line_account_id TEXT,
        folder_id TEXT
      );
      INSERT INTO templates
        (id, name, message_type, message_content, created_at, updated_at)
      VALUES
        ('tpl-legacy', '昔の挨拶', 'text', '公開中の本文',
         '2026-09-01T00:00:00+09:00', '2026-09-02T00:00:00+09:00');
    `);
    sqlite.exec(migration347);

    const row = sqlite.prepare(`SELECT * FROM templates WHERE id = ?`).get('tpl-legacy') as Record<string, unknown>;
    // 公開版のまま。下書きはなし。
    expect(row['message_content']).toBe('公開中の本文');
    expect(row['published_version']).toBe(1);
    expect(row['published_at']).toBe('2026-09-02T00:00:00+09:00');
    expect(row['draft_message_content']).toBeNull();
    expect(hasTemplateDraft(row as unknown as TemplateRow)).toBe(false);
  });
});
