import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createTemplate,
  getSendableTemplate,
  getTemplateById,
  hasTemplateDraft,
  isTemplateAssociable,
  isTemplateSendable,
  publishTemplate,
  saveTemplateDraft,
  templateDraftFingerprint,
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

/** 347 が参照する、適用直前の所有関係だけを持つ実SQLite。 */
function openPre347Db(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
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
    CREATE TABLE auto_replies (template_id TEXT, line_account_id TEXT);
    CREATE TABLE scenarios (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE scenario_steps (template_id TEXT, scenario_id TEXT);
    CREATE TABLE reminders (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE reminder_steps (template_id TEXT, reminder_id TEXT);
    CREATE TABLE rich_menu_groups (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE rich_menu_pages (id TEXT PRIMARY KEY, group_id TEXT NOT NULL);
    CREATE TABLE rich_menu_areas (template_id TEXT, page_id TEXT NOT NULL);
    CREATE TABLE automations (actions TEXT NOT NULL DEFAULT '[]', line_account_id TEXT);
    CREATE TABLE common_actions (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL);
    CREATE TABLE common_action_versions (common_action_id TEXT NOT NULL, action_config TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE friend_bulk_runs (id TEXT PRIMARY KEY, operation_json TEXT NOT NULL);
    CREATE TABLE friend_bulk_run_items (run_id TEXT NOT NULL, line_account_id TEXT);
  `);
  return sqlite;
}

function createUnpublishedTemplate(db: D1Database, messageContent = '最初の本文') {
  // 持ち主なし(関連付け口の reminders と同じ約束で通す古い形)。
  return createTemplate(db, { name: 'あいさつ', messageType: 'text', messageContent });
}

describe('migration 347 テンプレートの公開版固定(#645 / N-131・差し戻し6要件)', () => {
  it('作った直後は未公開の下書きで始まり、初回の明示公開で版1になる(要件4)', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);

    // 未公開: 版0・公開日時なし・下書きあり。送信候補の目印。
    expect(created.published_version).toBe(0);
    expect(created.published_at).toBeNull();
    expect(hasTemplateDraft(created)).toBe(true);
    expect(created.draft_revision).toBe(1);
    expect(created.draft_message_content).toBe('最初の本文');

    const result = await publishTemplate(db, created.id, { idempotencyKey: 'first-publish-0001' });
    expect(result.published).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.row.published_version).toBe(1);
    expect(result.row.published_at).not.toBeNull();
    expect(result.row.message_content).toBe('最初の本文');
    expect(hasTemplateDraft(result.row)).toBe(false);
  });

  it('下書き保存だけでは公開版が変わらず、2回目の保存が残る', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);

    await saveTemplateDraft(db, created.id, { messageContent: '1回目の編集' });
    const mid = (await getTemplateById(db, created.id))!;
    expect(mid.draft_revision).toBe(2);
    await saveTemplateDraft(db, created.id, { messageContent: '2回目の編集' });

    const row = (await getTemplateById(db, created.id))!;
    // 公開版は不変。
    expect(row.message_content).toBe('最初の本文');
    expect(row.published_version).toBe(0);
    // 下書きには2回目の内容が残る。
    expect(row.draft_message_content).toBe('2回目の編集');
    expect(row.draft_message_type).toBe('text');
    expect(row.draft_revision).toBe(3);
    expect(hasTemplateDraft(row)).toBe(true);
  });

  it('公開すると下書きが公開版になり、版が1つ進んで下書きが消える', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '公開したい本文' });

    const result = await publishTemplate(db, created.id, {
      expectedVersion: 0,
      idempotencyKey: 'publish-key-0001',
    });

    expect(result.published).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.row.message_content).toBe('公開したい本文');
    expect(result.row.published_version).toBe(1);
    expect(result.row.draft_revision).toBe(0);
    expect(hasTemplateDraft(result.row)).toBe(false);
  });

  it('質問・カルーセル・制限超過文の削除は、公開で消えたままになり旧値が復活しない(要件2)', async () => {
    const db = openMigratedDb();
    const questionJson = JSON.stringify({
      text: '続けますか?',
      tapMode: 'single',
      choices: [{ label: 'はい', behavior: 'none' }],
    });
    const carouselActions = { 0: { 0: [{ type: 'text', text: '押した' }] } };
    const created = await createTemplate(db, {
      name: '質問つき',
      messageType: 'text',
      messageContent: '最初の本文',
      questionJson,
      carouselActions,
      carouselTapLimitMode: 'once',
      carouselTapLimitText: 'もう押せません',
    });
    // 公開して旧値を公開版にする。
    await publishTemplate(db, created.id, { idempotencyKey: 'delete-test-publish-1' });
    const live = (await getTemplateById(db, created.id))!;
    expect(live.question_json).toBe(questionJson);
    expect(live.carousel_tap_limit_text).toBe('もう押せません');

    // 3つを消す。
    await saveTemplateDraft(db, created.id, {
      questionJson: null,
      carouselActions: null,
      carouselTapLimitText: null,
    });
    const draft = (await getTemplateById(db, created.id))!;
    expect(hasTemplateDraft(draft)).toBe(true);

    // 別の項目だけ足しても、消した3つは復活しない。
    await saveTemplateDraft(db, created.id, { messageContent: '本文だけ直す' });
    const redraft = (await getTemplateById(db, created.id))!;
    expect(redraft.draft_question_json).toBeNull();
    expect(redraft.draft_carousel_actions_json).toBeNull();
    expect(redraft.draft_carousel_tap_limit_text).toBeNull();

    // 公開しても旧値は戻らない。
    const result = await publishTemplate(db, created.id, { idempotencyKey: 'delete-test-publish-2' });
    expect(result.published).toBe(true);
    expect(result.row.question_json).toBeNull();
    expect(result.row.carousel_actions_json).toBeNull();
    expect(result.row.carousel_tap_limit_text).toBeNull();
    expect(result.row.message_content).toBe('本文だけ直す');
  });

  it('検査後に下書きが書き換わったら、古い下書き版での公開を止める(要件3)', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '確認した本文' });
    const seen = (await getTemplateById(db, created.id))!;

    // 別人がその後に書き換えた。
    await saveTemplateDraft(db, created.id, { messageContent: '確認していない本文' });

    await expect(
      publishTemplate(db, created.id, {
        expectedDraftRevision: seen.draft_revision,
        idempotencyKey: 'draft-cas-stale',
      }),
    ).rejects.toThrow('TEMPLATE_DRAFT_CONFLICT');

    const kept = (await getTemplateById(db, created.id))!;
    expect(kept.message_content).toBe('最初の本文');
    expect(kept.published_version).toBe(0);

    // 開き直した版なら公開できる。
    const fresh = (await getTemplateById(db, created.id))!;
    const result = await publishTemplate(db, created.id, {
      expectedDraftRevision: fresh.draft_revision,
      idempotencyKey: 'draft-cas-fresh',
    });
    expect(result.published).toBe(true);
    expect(result.row.message_content).toBe('確認していない本文');
  });

  it('下書きがない公開も確認キーを記録し、再試行は同じ結果になる(要件5)', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);

    const first = await publishTemplate(db, created.id, { idempotencyKey: 'retry-key-0002' });
    expect(first.published).toBe(true);
    expect(first.row.published_version).toBe(1);

    // 下書きなしの成功を同キーで再試行しても、何も起きない。
    const second = await publishTemplate(db, created.id, { idempotencyKey: 'retry-key-0002' });
    expect(second.published).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.row.published_version).toBe(1);
  });

  it('同じ確認キーでの再試行は公開済みの結果をそのまま返す', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '公開したい本文' });

    await publishTemplate(db, created.id, { idempotencyKey: 'publish-key-0003' });
    const replay = await publishTemplate(db, created.id, { idempotencyKey: 'publish-key-0003' });

    expect(replay.published).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.row.message_content).toBe('公開したい本文');
    expect(replay.row.published_version).toBe(1);
  });

  it('後日の同キー再試行で別の下書きを出す使い回しは409(再審査5)', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '最初の公開' });
    await publishTemplate(db, created.id, { idempotencyKey: 'publish-key-0004' });

    // 後日、新しい下書きができても、同キーでは公開しない。
    await saveTemplateDraft(db, created.id, { messageContent: '次の編集' });
    await expect(
      publishTemplate(db, created.id, { idempotencyKey: 'publish-key-0004' }),
    ).rejects.toThrow('TEMPLATE_PUBLISH_KEY_CONFLICT');

    const row = (await getTemplateById(db, created.id))!;
    expect(row.message_content).toBe('最初の公開');
    expect(row.published_version).toBe(1);
    expect(hasTemplateDraft(row)).toBe(true);
  });

  it('同じ内容の同キー再試行は記録時の版・本文をそのまま返す(固定応答・再審査5)', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);
    await saveTemplateDraft(db, created.id, { messageContent: '最初の公開' });
    await publishTemplate(db, created.id, { idempotencyKey: 'fixed-key' });

    // 別キーで版が進んでも、同キーの再試行は記録時の結果を変えない。
    await saveTemplateDraft(db, created.id, { messageContent: '2回目の公開' });
    await publishTemplate(db, created.id, { idempotencyKey: 'fixed-key-2' });

    const retry = await publishTemplate(db, created.id, { idempotencyKey: 'fixed-key' });
    expect(retry.published).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.row.published_version).toBe(1);
    expect(retry.row.message_content).toBe('最初の公開');

    const row = (await getTemplateById(db, created.id))!;
    expect(row.published_version).toBe(2);
    expect(row.message_content).toBe('2回目の公開');
  });

  it('古い複数の成功キーはどれも再試行でき、版を進めない(要件5)', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);
    await publishTemplate(db, created.id, { idempotencyKey: 'old-key-1' });
    await saveTemplateDraft(db, created.id, { messageContent: '2回目の公開' });
    await publishTemplate(db, created.id, { idempotencyKey: 'old-key-2' });

    const before = (await getTemplateById(db, created.id))!;
    expect(before.published_version).toBe(2);

    // 古いキーはそれぞれ記録時の結果を返す(固定応答)。版は進めない。
    const replay1 = await publishTemplate(db, created.id, { idempotencyKey: 'old-key-1' });
    expect(replay1.published).toBe(false);
    expect(replay1.replayed).toBe(true);
    expect(replay1.row.published_version).toBe(1);
    const replay2 = await publishTemplate(db, created.id, { idempotencyKey: 'old-key-2' });
    expect(replay2.published).toBe(false);
    expect(replay2.replayed).toBe(true);
    expect(replay2.row.published_version).toBe(2);
    const after = (await getTemplateById(db, created.id))!;
    expect(after.message_content).toBe('2回目の公開');
  });

  it('同じ確認キーの同時公開は1回だけ通り、版は1つだけ進む(要件5)', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);

    const [first, second] = await Promise.all([
      publishTemplate(db, created.id, { idempotencyKey: 'race-key' }),
      publishTemplate(db, created.id, { idempotencyKey: 'race-key' }),
    ]);
    const publishedCount = [first, second].filter((r) => r.published).length;
    expect(publishedCount).toBeLessThanOrEqual(1);

    const row = (await getTemplateById(db, created.id))!;
    // 初回公開なので版は最大でも1。重複公開はない。
    expect(row.published_version).toBeLessThanOrEqual(1);
  });

  it('古い版番号での公開は同時更新の負けとして断る', async () => {
    const db = openMigratedDb();
    const created = await createUnpublishedTemplate(db);
    await publishTemplate(db, created.id, { expectedVersion: 0 });

    // 版は1へ進んだ。古い版0を指定した同時更新は通さない。
    await saveTemplateDraft(db, created.id, { messageContent: '遅れてきた公開' });
    await expect(
      publishTemplate(db, created.id, { expectedVersion: 0 }),
    ).rejects.toThrow('TEMPLATE_VERSION_CONFLICT');

    const row = (await getTemplateById(db, created.id))!;
    expect(row.message_content).toBe('最初の本文');
    expect(row.published_version).toBe(1);
  });

  it('ないテンプレートの下書き保存・公開は見つからないと返す', async () => {
    const db = openMigratedDb();
    await expect(saveTemplateDraft(db, 'tpl-ない', { messageContent: 'x' })).rejects.toThrow(
      'TEMPLATE_NOT_FOUND',
    );
    await expect(publishTemplate(db, 'tpl-ない')).rejects.toThrow('TEMPLATE_NOT_FOUND');
  });

  it('確認と書き込みの間に挟まった保存は、下書き版の条件で落とす(再審査1・割込競合)', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    const raw = sqlite;
    // 公開 UPDATE の直前に別人の PUT が割り込んだことにする。
    const interrupting = {
      ...asD1(sqlite),
      prepare: (query: string) => {
        if (query.includes('published_version = published_version + 1')) {
          raw.prepare(
            `UPDATE templates
                SET draft_message_content = '確認していない本文',
                    draft_revision = draft_revision + 1
              WHERE id = ?`,
          ).run(raceId);
        }
        return asD1(sqlite).prepare(query);
      },
    } as unknown as D1Database;
    const created = await createTemplate(asD1(sqlite), {
      name: 'あいさつ', messageType: 'text', messageContent: '最初の本文',
    });
    const raceId = created.id;
    await saveTemplateDraft(asD1(sqlite), raceId, { messageContent: '確認した本文' });

    await expect(
      publishTemplate(interrupting, raceId, { idempotencyKey: 'interrupt-key' }),
    ).rejects.toThrow('TEMPLATE_DRAFT_CONFLICT');

    const row = (await getTemplateById(asD1(sqlite), raceId))!;
    expect(row.message_content).toBe('最初の本文');
    expect(row.published_version).toBe(0);
    expect(hasTemplateDraft(row)).toBe(true);
  });

  it('確認と書き込みの間に挟まった公開は、公開版の条件で落とす(再審査1・割込競合)', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    const raw = sqlite;
    const created = await createTemplate(asD1(sqlite), {
      name: 'あいさつ', messageType: 'text', messageContent: '最初の本文',
    });
    const raceId = created.id;
    const interrupting = {
      ...asD1(sqlite),
      prepare: (query: string) => {
        if (query.includes('published_version = published_version + 1')) {
          raw.prepare(`UPDATE templates SET published_version = published_version + 1 WHERE id = ?`).run(raceId);
        }
        return asD1(sqlite).prepare(query);
      },
    } as unknown as D1Database;

    await expect(
      publishTemplate(interrupting, raceId, { idempotencyKey: 'interrupt-version-key' }),
    ).rejects.toThrow('TEMPLATE_VERSION_CONFLICT');

    const row = (await getTemplateById(asD1(sqlite), raceId))!;
    expect(row.message_content).toBe('最初の本文');
  });

  it('キー記録の途中で落ちても版だけ進まない(独立審査P1・途中障害)', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    const db = asD1(sqlite);
    const created = await createTemplate(db, {
      name: 'あいさつ', messageType: 'text', messageContent: '最初の本文',
    });
    await saveTemplateDraft(db, created.id, { messageContent: '公開したい本文' });
    // キー記録だけを落とす。版更新と記録が別SQLなら版だけ進んでしまう。
    sqlite.exec(
      `CREATE TRIGGER fail_key_insert BEFORE INSERT ON template_publish_keys
       BEGIN SELECT RAISE(ABORT, 'mid-failure'); END;`,
    );

    await expect(
      publishTemplate(db, created.id, { idempotencyKey: 'mid-failure-key' }),
    ).rejects.toThrow();

    const row = (await getTemplateById(db, created.id))!;
    expect(row.published_version).toBe(0);
    expect(row.message_content).toBe('最初の本文');
    expect(hasTemplateDraft(row)).toBe(true);
    expect(row.draft_message_content).toBe('公開したい本文');
  });

  it('旧NULL所有者をリッチメニューの持ち主へ補完し、公開版を実送信で読める', async () => {
    const sqlite = openPre347Db();
    sqlite.exec(`
      INSERT INTO line_accounts (id) VALUES ('account-1'), ('account-2');
      INSERT INTO templates
        (id, name, message_type, message_content, created_at, updated_at)
      VALUES
        ('tpl-legacy', '昔の挨拶', 'text', '公開中の本文',
         '2026-09-01T00:00:00+09:00', '2026-09-02T00:00:00+09:00');
      INSERT INTO rich_menu_groups (id, account_id) VALUES ('group-1', 'account-1');
      INSERT INTO rich_menu_pages (id, group_id) VALUES ('page-1', 'group-1');
      INSERT INTO rich_menu_areas (template_id, page_id) VALUES ('tpl-legacy', 'page-1');
    `);
    sqlite.exec(migration347);

    const row = sqlite.prepare(`SELECT * FROM templates WHERE id = ?`).get('tpl-legacy') as Record<string, unknown>;
    // 公開版のまま、参照元と同じ持ち主になり、実送信の取得口でも読める。
    expect(row['line_account_id']).toBe('account-1');
    expect(row['message_content']).toBe('公開中の本文');
    expect(row['published_version']).toBe(1);
    expect(row['published_at']).toBe('2026-09-02T00:00:00+09:00');
    expect(row['draft_message_content']).toBeNull();
    expect(row['draft_revision']).toBe(0);
    expect(hasTemplateDraft(row as unknown as TemplateRow)).toBe(false);
    expect(await getSendableTemplate(asD1(sqlite), 'tpl-legacy', 'account-1')).toMatchObject({
      id: 'tpl-legacy',
      message_content: '公開中の本文',
      line_account_id: 'account-1',
      published_version: 1,
    });
  });

  it('旧NULL所有者が複数アカウントに参照される移行は、ALTER前にfail-closeする', () => {
    const sqlite = openPre347Db();
    sqlite.exec(`
      INSERT INTO line_accounts (id) VALUES ('account-1'), ('account-2');
      INSERT INTO templates
        (id, name, message_type, message_content, created_at, updated_at)
      VALUES
        ('tpl-conflict', '共有されていた挨拶', 'text', '本文', '2026-09-01', '2026-09-02');
      INSERT INTO rich_menu_groups (id, account_id)
      VALUES ('group-1', 'account-1'), ('group-2', 'account-2');
      INSERT INTO rich_menu_pages (id, group_id)
      VALUES ('page-1', 'group-1'), ('page-2', 'group-2');
      INSERT INTO rich_menu_areas (template_id, page_id)
      VALUES ('tpl-conflict', 'page-1'), ('tpl-conflict', 'page-2');
    `);

    expect(() => sqlite.exec(migration347)).toThrow(/malformed JSON/i);
    const columns = sqlite.prepare(`PRAGMA table_info(templates)`).all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'published_version')).toBe(false);
    expect(sqlite.prepare(
      `SELECT line_account_id FROM templates WHERE id = 'tpl-conflict'`,
    ).get()).toEqual({ line_account_id: null });
  });
});

describe('送ってよいテンプレートの見分け(再審査2・3)', () => {
  it('未公開・別アカウントは送れず、公開版の同一アカウントは送れる', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', '店舗1', 'token', 'secret')`,
    ).run();
    const db = asD1(sqlite);
    const created = await createTemplate(db, {
      name: 'あいさつ', messageType: 'text', messageContent: '最初の本文', lineAccountId: 'account-1',
    });

    // 未公開(版0)は送れない。
    expect(isTemplateSendable(created, 'account-1')).toBe(false);
    expect(await getSendableTemplate(db, created.id, 'account-1')).toBeNull();

    await publishTemplate(db, created.id, { idempotencyKey: 'sendable-key' });
    const live = (await getTemplateById(db, created.id))!;
    expect(isTemplateSendable(live, 'account-1')).toBe(true);
    expect(await getSendableTemplate(db, created.id, 'account-1')).not.toBeNull();
  });

  it('送信は両方が分かり完全一致のときだけ通す(fail-close・独立審査指摘3)', () => {
    expect(isTemplateSendable({ published_version: 1, line_account_id: 'account-1' }, 'account-1')).toBe(true);
    expect(isTemplateSendable({ published_version: 1, line_account_id: 'account-2' }, 'account-1')).toBe(false);
    expect(isTemplateSendable({ published_version: 1, line_account_id: null }, 'account-1')).toBe(false);
    expect(isTemplateSendable({ published_version: 1, line_account_id: 'account-1' }, null)).toBe(false);
    expect(isTemplateSendable({ published_version: 0, line_account_id: 'account-1' }, 'account-1')).toBe(false);
    expect(isTemplateSendable(null, 'account-1')).toBe(false);
  });

  it('関連付けも送信と同じく両方が分かり完全一致のときだけ通す(fail-close・独立審査指摘3)', () => {
    expect(isTemplateAssociable({ published_version: 1, line_account_id: 'account-1' }, 'account-1')).toBe(true);
    expect(isTemplateAssociable({ published_version: 1, line_account_id: 'account-2' }, 'account-1')).toBe(false);
    expect(isTemplateAssociable({ published_version: 1, line_account_id: null }, 'account-1')).toBe(false);
    // 持ち主未定の結びつけは通さない。通すと送る側で別アカウントの公開版が混ざる。
    expect(isTemplateAssociable({ published_version: 1, line_account_id: 'account-1' }, null)).toBe(false);
    expect(isTemplateAssociable({ published_version: 1, line_account_id: 'account-1' }, undefined)).toBe(false);
    expect(isTemplateAssociable({ published_version: 0, line_account_id: 'account-1' }, null)).toBe(false);
    expect(isTemplateAssociable(null, 'account-1')).toBe(false);
  });

  it('指紋は同じ内容で同じ値、1文字の違いや削除で変わる(SHA-256・独立審査P1)', async () => {
    const base = {
      draft_message_type: 'text',
      draft_message_content: '本文',
      draft_carousel_actions_json: null,
      draft_carousel_tap_limit_mode: 'none',
      draft_carousel_tap_limit_text: null,
      draft_question_json: null,
      draft_question_status: 'published' as const,
    };
    const fingerprint = await templateDraftFingerprint(base);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await templateDraftFingerprint({ ...base })).toBe(fingerprint);
    expect(await templateDraftFingerprint({ ...base, draft_message_content: '本文!' })).not.toBe(fingerprint);
    expect(await templateDraftFingerprint({ ...base, draft_question_json: '{"text":"q"}' })).not.toBe(fingerprint);
  });
});
