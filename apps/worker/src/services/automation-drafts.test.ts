import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  createAutomationDraftFromDefinition,
  createAutomationDraftFromTemplate,
  duplicateAutomationDefinition,
  getAutomationDraft,
  listAutomationDraftResources,
  listAutomationTemplates,
  updateAutomationDraft,
} from './automation-drafts';

function addAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active)
     VALUES (?, ?, ?, '', '', 1)`,
  ).run(id, `channel-${id}`, id);
}

describe('オートメーションの見本と下書き', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
    testDb.raw.prepare(
      "INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '予約', 'account-1')",
    ).run();
    testDb.raw.prepare(
      "INSERT INTO tags (id, name, line_account_id) VALUES ('tag-2', '別店舗', 'account-2')",
    ).run();
    testDb.raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
       VALUES ('scenario-1', '予約後', 'manual', 1, 'account-1')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
       VALUES ('scenario-stopped', '停止中', 'manual', 0, 'account-1')`,
    ).run();
  });

  it('選んだアカウントのタグと稼働中シナリオ・公開済み共通アクションだけを返す', async () => {
    // #942 N-356: 呼び出せるのは公開済みの版を持つ共通アクションだけ。
    // 下書き・公開版なし・別アカウントは選択肢に出さない。
    testDb.raw.prepare(
      `INSERT INTO common_actions (id, line_account_id, name, status, current_published_version_id)
       VALUES ('ca-1', 'account-1', '会員向け一式', 'published', 'cv-1'),
              ('ca-draft', 'account-1', 'まだ下書き', 'draft', NULL),
              ('ca-nover', 'account-1', '版が無い', 'published', NULL),
              ('ca-2', 'account-2', '別店舗のもの', 'published', 'cv-2')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO common_action_versions (id, common_action_id, version_number, status, action_config)
       VALUES ('cv-1', 'ca-1', 1, 'published', '[]'),
              ('cv-2', 'ca-2', 1, 'published', '[]')`,
    ).run();
    expect(await listAutomationDraftResources(testDb.db, 'account-1')).toEqual({
      tags: [{ id: 'tag-1', name: '予約' }],
      scenarios: [{ id: 'scenario-1', name: '予約後' }],
      commonActions: [{ id: 'ca-1', name: '会員向け一式' }],
    });
  });

  it('実行まで接続済みの見本だけを返す', () => {
    expect(listAutomationTemplates()).toEqual([
      expect.objectContaining({ key: 'welcome-scenario' }),
      expect.objectContaining({ key: 'received-message-tag' }),
      expect.objectContaining({ key: 'tag-followup-scenario' }),
    ]);
  });

  it('見本は実データIDを持たない非公開の下書きとして複製する', async () => {
    const created = await createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'welcome-scenario',
      lineAccountId: 'account-1',
      operationKey: 'op-welcome-1',
      createdBy: 'staff-1',
    });
    const draft = await getAutomationDraft(testDb.db, { id: created.id, lineAccountId: 'account-1' });
    expect(draft).toMatchObject({
      draftVersionId: created.draftVersionId,
      eventType: 'friend_add',
      actions: [{ type: 'start_scenario', params: { scenarioId: '' } }],
    });
    expect(testDb.raw.prepare(
      'SELECT status, current_published_version_id FROM automation_definitions WHERE id = ?',
    ).get(created.id)).toEqual({ status: 'draft', current_published_version_id: null });
  });

  it('別アカウントから下書きを読めない', async () => {
    const created = await createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag',
      lineAccountId: 'account-1',
      operationKey: 'op-read-1',
    });
    await expect(getAutomationDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-2',
    })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('同じアカウントの資源だけを下書きへ保存する', async () => {
    const created = await createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'tag-followup-scenario',
      lineAccountId: 'account-1',
      operationKey: 'op-follow-1',
    });
    await updateAutomationDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: created.draftVersionId,
      name: '予約後フォロー',
      eventType: 'tag_change',
      triggerConfig: { tagId: 'tag-1', action: 'remove' },
      actions: [{
        id: 'step-1',
        type: 'start_scenario',
        params: { scenarioId: 'scenario-1' },
        onFailure: 'stop',
      }],
    });
    const draft = await getAutomationDraft(testDb.db, { id: created.id, lineAccountId: 'account-1' });
    expect(draft).toMatchObject({
      name: '予約後フォロー',
      triggerConfig: { tagId: 'tag-1', action: 'remove' },
      actions: [{ type: 'start_scenario', params: { scenarioId: 'scenario-1' } }],
    });
    expect(testDb.raw.prepare('SELECT status FROM automation_definitions WHERE id = ?').get(created.id))
      .toEqual({ status: 'draft' });
  });

  it('別アカウント・停止中の参照先と古い版を拒否する', async () => {
    const created = await createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag',
      lineAccountId: 'account-1',
      operationKey: 'op-reject-1',
    });
    await expect(updateAutomationDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: created.draftVersionId,
      name: '問い合わせ',
      eventType: 'message_received',
      triggerConfig: {},
      actions: [{ id: 'step-1', type: 'add_tag', params: { tagId: 'tag-2' }, onFailure: 'stop' }],
    })).rejects.toMatchObject({ code: 'resource_not_found', field: 'actions.0.tagId' });
    await expect(updateAutomationDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: created.draftVersionId,
      name: '問い合わせ',
      eventType: 'friend_add',
      triggerConfig: {},
      actions: [{
        id: 'step-1',
        type: 'start_scenario',
        params: { scenarioId: 'scenario-stopped' },
        onFailure: 'stop',
      }],
    })).rejects.toMatchObject({ code: 'resource_not_found', field: 'actions.0.scenarioId' });
    await expect(updateAutomationDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: 'old-version',
      name: '問い合わせ',
      eventType: 'message_received',
      triggerConfig: {},
      actions: [{ id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }],
    })).rejects.toMatchObject({ code: 'version_conflict' });
  });
});


describe('保存は、読んだときの中身にだけ効く（#679）', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    testDb.raw.prepare(
      "INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '予約', 'account-1')",
    ).run();
  });

  const save = (db: D1Database, id: string, revision: string, content: string) =>
    updateAutomationDraft(db, {
      id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: revision,
      name: '予約返信',
      eventType: 'message_received',
      triggerConfig: {},
      conditions: {},
      actions: [{ id: 'step-1', type: 'send_message', params: { messageType: 'text', content } }],
    });

  it('読んだあと・書く直前に別接続が同じ行を書き換えたら、上書きせず409で止まる', async () => {
    const created = await createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag', lineAccountId: 'account-1',
      operationKey: 'op-race-1', createdBy: 'staff-1',
    });
    const versionId = testDb.raw.prepare(
      'SELECT current_draft_version_id AS id FROM automation_definitions WHERE id = ?',
    ).get(created.id) as { id: string };

    /*
     * 中身を読んでから書き込むまでの隙間に、アプリを通さない書き換えを入れる。
     * 版の行のidは変わらないので、**書き込みの条件に中身を入れていないと素通りする。**
     */
    let interrupted = false;
    const racingDb = new Proxy(testDb.db, {
      get(target, key: string, receiver: unknown) {
        if (key !== 'batch') return Reflect.get(target, key, receiver) as unknown;
        return async (statements: D1PreparedStatement[]) => {
          if (!interrupted) {
            interrupted = true;
            testDb.raw.prepare(
              'UPDATE automation_versions SET action_config = ? WHERE id = ?',
            ).run(
              JSON.stringify([{ id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }]),
              versionId.id,
            );
          }
          return target.batch(statements);
        };
      },
    }) as D1Database;

    await expect(save(racingDb, created.id, created.draftVersionId, 'あとから来た保存'))
      .rejects.toMatchObject({ code: 'version_conflict' });

    expect(interrupted).toBe(true);
    // 割り込みが入れた中身がそのまま残っている（黙って上書きしていない）。
    const stored = testDb.raw.prepare(
      `SELECT v.action_config AS actions FROM automation_definitions d
         JOIN automation_versions v ON v.id = d.current_draft_version_id
        WHERE d.id = ?`,
    ).get(created.id) as { actions: string };
    expect(stored.actions).toContain('tag-1');
    expect(stored.actions).not.toContain('あとから来た保存');
  });

  it('保存すると版が新しくなり、前の札ではもう保存できない', async () => {
    const created = await createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag', lineAccountId: 'account-1',
      operationKey: 'op-save-1', createdBy: 'staff-1',
    });
    const first = await save(testDb.db, created.id, created.draftVersionId, '1回目');
    expect(first.draftVersionId).not.toBe(created.draftVersionId);

    // 版の行そのものが別になる（中身を書き換えていない＝不変）。
    const rows = testDb.raw.prepare(
      'SELECT COUNT(*) AS count FROM automation_versions WHERE automation_id = ?',
    ).get(created.id) as { count: number };
    expect(rows.count).toBe(2);

    await expect(save(testDb.db, created.id, created.draftVersionId, '古い札で2回目'))
      .rejects.toMatchObject({ code: 'version_conflict' });
    const second = await save(testDb.db, created.id, first.draftVersionId, '新しい札で2回目');
    expect(second.draftVersionId).not.toBe(first.draftVersionId);
  });
});

/*
 * DETAIL-13: 「同じ保存操作の再試行」と「別の新規作成」を、操作ごとの鍵で分ける。
 *
 * 以前は店・見本・担当者・世代だけでidを決めていたため、一覧からもう一度
 * 「新規」を押しても同じidへ戻り、新しい入力が前の下書きを上書きしていた。
 * いまは画面が新規作成のたびに新しい鍵を振り、同じ鍵の呼び出しだけが
 * 同じ下書きへ戻る（＝再試行だけが冪等）。既存の下書きを開くのは
 * `?draft=<id>` でidを明示したときだけ。
 */
describe('見本からの下書き作成は同じ操作なら1件・別の操作なら別件（DETAIL-13 / #679 A3）', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
  });

  const create = (accountId: string, operationKey: string, createdBy: string | null = 'staff-1') =>
    createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag',
      lineAccountId: accountId,
      operationKey,
      createdBy,
    });

  it('同じ操作の再試行（ダブルクリック・通信やり直し）は1件で、同じ札を返す', async () => {
    const [first, second] = await Promise.all([
      create('account-1', 'op-same-save'), create('account-1', 'op-same-save'),
    ]);
    expect(second.id).toBe(first.id);
    expect(second.draftVersionId).toBe(first.draftVersionId);
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS count FROM automation_definitions WHERE line_account_id = 'account-1'",
    ).get()).toEqual({ count: 1 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_versions').get())
      .toEqual({ count: 1 });
  });

  it('別の新規作成は別の下書きになる。前の下書きへ戻って上書きしない', async () => {
    const first = await create('account-1', 'op-first-new');
    const second = await create('account-1', 'op-second-new');
    expect(second.id).not.toBe(first.id);
    expect(second.draftVersionId).not.toBe(first.draftVersionId);
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS count FROM automation_definitions WHERE line_account_id = 'account-1'",
    ).get()).toEqual({ count: 2 });
    // 前の下書きはそのまま残っている。
    const firstDraft = await getAutomationDraft(testDb.db, {
      id: first.id, lineAccountId: 'account-1',
    });
    expect(firstDraft.id).toBe(first.id);
  });

  it('別タブが同時に押しても、別の操作なら別の下書きになる', async () => {
    /*
     * 別タブは別の作成操作。以前は同じidへ潰れて片方のタブがもう片方の
     * 下書きを上書きしていた（DETAIL-13）。同時に着いても2件で終わる。
     */
    const [first, second] = await Promise.all([
      create('account-1', 'op-tab-1'), create('account-1', 'op-tab-2'),
    ]);
    expect(second.id).not.toBe(first.id);
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS count FROM automation_definitions WHERE line_account_id = 'account-1'",
    ).get()).toEqual({ count: 2 });
  });

  it('店が違えば別の下書きになる', async () => {
    const first = await create('account-1', 'op-shared');
    const second = await create('account-2', 'op-shared');
    expect(second.id).not.toBe(first.id);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_definitions').get())
      .toEqual({ count: 2 });
  });

  it('担当者が違えば別の下書きになる', async () => {
    const first = await create('account-1', 'op-shared', 'staff-1');
    const second = await create('account-1', 'op-shared', 'staff-2');
    expect(second.id).not.toBe(first.id);
  });

  it('前の下書きを公開したあとは、新しい下書きを作る', async () => {
    const first = await create('account-1', 'op-publish-then-new');
    testDb.raw.prepare(
      "UPDATE automation_definitions SET status = 'active' WHERE id = ?",
    ).run(first.id);
    const second = await create('account-1', 'op-publish-then-new');
    expect(second.id).not.toBe(first.id);
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS count FROM automation_definitions WHERE status = 'draft'",
    ).get()).toEqual({ count: 1 });
  });

  it('操作の鍵が無い・形が違う呼び出しは断る（前の下書きへ戻る道を塞ぐ）', async () => {
    await expect(createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag', lineAccountId: 'account-1',
      operationKey: undefined,
    })).rejects.toMatchObject({ code: 'operation_key_invalid' });
    await expect(createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag', lineAccountId: 'account-1',
      operationKey: 'x',
    })).rejects.toMatchObject({ code: 'operation_key_invalid' });
    await expect(createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag', lineAccountId: 'account-1',
      operationKey: 42,
    })).rejects.toMatchObject({ code: 'operation_key_invalid' });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_definitions').get())
      .toEqual({ count: 0 });
  });
});

/*
 * #942 N-352: 一覧の「編集」「複製」。
 * 公開済みの版は不変なので、直すには公開版を写した下書きをぶら下げる。
 * 複製は見えている版を写した新しい下書きを作り、共通アクションの束も
 * 新しい定義へ付け替える。
 */
describe('公開済み定義の編集・複製（#942 N-352）', () => {
  let testDb: SqliteD1;

  /** 公開版を持つ active の定義を1件作る。 */
  function addActiveDefinition(
    raw: Database.Database,
    input: { id?: string; name?: string; status?: string; accountId?: string } = {},
  ): string {
    const id = input.id ?? 'auto-1';
    const accountId = input.accountId ?? 'account-1';
    const versionId = `${id}-v1`;
    raw.prepare(
      `INSERT INTO automation_definitions
         (id, line_account_id, name, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, 5, datetime('now'), datetime('now'))`,
    ).run(id, accountId, input.name ?? '予約後フォロー', input.status ?? 'active');
    raw.prepare(
      `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, trigger_config,
          condition_config, action_config, published_at)
       VALUES (?, ?, 1, 'published', 'tag_change', '{"tagId":"tag-1","action":"add"}',
               '{}', '[{"id":"step-1","type":"common_action","params":{"commonActionId":"ca-1"},"onFailure":"stop"}]', datetime('now'))`,
    ).run(versionId, id);
    raw.prepare(
      `UPDATE automation_definitions SET current_published_version_id = ? WHERE id = ?`,
    ).run(versionId, id);
    return versionId;
  }

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
  });

  it('公開済みの定義へ、公開版を写した改訂用の下書きをぶら下げる', async () => {
    const versionId = addActiveDefinition(testDb.raw);
    const created = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1', createdBy: 'staff-1',
    });
    expect(created.id).toBe('auto-1');

    const draft = await getAutomationDraft(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
    });
    expect(draft).toMatchObject({
      eventType: 'tag_change',
      triggerConfig: { tagId: 'tag-1', action: 'add' },
      actions: [{ type: 'common_action', params: { commonActionId: 'ca-1' } }],
    });
    const versions = testDb.raw.prepare(
      `SELECT id, version_number, status FROM automation_versions WHERE automation_id = ? ORDER BY version_number`,
    ).all('auto-1') as Array<{ id: string; version_number: number; status: string }>;
    expect(versions).toEqual([
      { id: versionId, version_number: 1, status: 'published' },
      { id: expect.any(String), version_number: 2, status: 'draft' },
    ]);
    // 本体は動作中のまま。下書きは別の版としてぶら下がる。
    expect(testDb.raw.prepare(
      `SELECT status FROM automation_definitions WHERE id = 'auto-1'`,
    ).get()).toEqual({ status: 'active' });
  });

  it('下書きがすでにあれば新しく作らず、同じ下書きを返す', async () => {
    addActiveDefinition(testDb.raw);
    const first = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
    });
    const second = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
    });
    expect(second).toEqual(first);
    expect(testDb.raw.prepare(
      `SELECT COUNT(*) AS count FROM automation_versions WHERE automation_id = 'auto-1'`,
    ).get()).toEqual({ count: 2 });
  });

  /*
   * AUTOMATION-05: 一覧の「編集」は、止めている・下書き・動いているの
   * どの状態でも同じidのまま編集面へ進めなければならない。稼働状態と
   * 実行記録は一切変えない。
   */
  it('止めている定義も同じidの改訂用下書きで開け、状態は止めたまま（AUTOMATION-05）', async () => {
    const versionId = addActiveDefinition(testDb.raw, { status: 'stopped' });
    const created = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1', createdBy: 'staff-1',
    });
    expect(created.id).toBe('auto-1');

    const draft = await getAutomationDraft(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
    });
    expect(draft).toMatchObject({
      eventType: 'tag_change',
      triggerConfig: { tagId: 'tag-1', action: 'add' },
      actions: [{ type: 'common_action', params: { commonActionId: 'ca-1' } }],
    });
    const definition = testDb.raw.prepare(
      `SELECT status, current_published_version_id FROM automation_definitions WHERE id = 'auto-1'`,
    ).get() as { status: string; current_published_version_id: string };
    // 公開版はそのまま、定義は止めたまま。
    expect(definition).toEqual({ status: 'stopped', current_published_version_id: versionId });
  });

  it('下書きの定義は、ぶら下がっている下書きをそのまま返す（AUTOMATION-05）', async () => {
    testDb.raw.prepare(
      `INSERT INTO automation_definitions
         (id, line_account_id, name, status, current_draft_version_id, created_at, updated_at)
       VALUES ('draft-1', 'account-1', '作りかけ', 'draft', 'dv-1', datetime('now'), datetime('now'))`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, trigger_config,
          condition_config, action_config)
       VALUES ('dv-1', 'draft-1', 1, 'draft', 'message_received', '{}', '{}',
               '[{"id":"step-1","type":"send_message","params":{"content":"確認"},"onFailure":"stop"}]')`,
    ).run();

    const created = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'draft-1', lineAccountId: 'account-1',
    });
    expect(created.id).toBe('draft-1');
    const draft = await getAutomationDraft(testDb.db, {
      id: 'draft-1', lineAccountId: 'account-1',
    });
    expect(draft.draftVersionId).toBe(created.draftVersionId);
    expect(draft).toMatchObject({ eventType: 'message_received' });
    // 版を増やしていない（既存の下書きをそのまま再開した）。
    expect(testDb.raw.prepare(
      `SELECT COUNT(*) AS count FROM automation_versions WHERE automation_id = 'draft-1'`,
    ).get()).toEqual({ count: 1 });
  });

  it('下書きの指し先が壊れていても、公開版から作り直して同じidで開ける（AUTOMATION-05）', async () => {
    const versionId = addActiveDefinition(testDb.raw, { status: 'stopped' });
    /*
     * 「編集用の下書きを作れませんでした」の再現: 下書きの指し先が
     * 下書きではない版（ここでは公開版）を指している壊れた状態。
     * 以前は not_found のままで一覧の「編集」が永久に失敗した。
     */
    testDb.raw.prepare(
      `UPDATE automation_definitions SET current_draft_version_id = ? WHERE id = 'auto-1'`,
    ).run(versionId);

    const created = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1', createdBy: 'staff-1',
    });
    expect(created.id).toBe('auto-1');

    // 公開版を写した新しい下書き版がぶら下がり、指し先はそこへ治っている。
    const definition = testDb.raw.prepare(
      `SELECT status, current_draft_version_id, current_published_version_id
         FROM automation_definitions WHERE id = 'auto-1'`,
    ).get() as {
      status: string;
      current_draft_version_id: string;
      current_published_version_id: string;
    };
    expect(definition.status).toBe('stopped');
    expect(definition.current_published_version_id).toBe(versionId);
    expect(definition.current_draft_version_id).not.toBe(versionId);
    const newVersion = testDb.raw.prepare(
      `SELECT status, trigger_type FROM automation_versions WHERE id = ?`,
    ).get(definition.current_draft_version_id) as { status: string; trigger_type: string };
    expect(newVersion).toEqual({ status: 'draft', trigger_type: 'tag_change' });

    // そのまま読める（編集面が開ける）状態になっている。
    const draft = await getAutomationDraft(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
    });
    expect(draft).toMatchObject({ eventType: 'tag_change' });
  });

  it('壊れた指し先の上書きはしない——別の下書きが先に付いたらそちらを返す（AUTOMATION-05）', async () => {
    addActiveDefinition(testDb.raw);
    // 先に別の下書きがぶら下がっている（同時押しで先に作られた側）。
    const first = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
    });
    // 公開版を写す新しい版を足さず、既存の下書きをそのまま返す。
    const second = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
    });
    expect(second).toEqual(first);
  });

  it('保管済み・下書きだけの定義と別アカウントは編集に出さない', async () => {
    addActiveDefinition(testDb.raw, { id: 'archived-one', status: 'archived' });
    // 下書きだけ = 公開版が無いので編集口は not_found。
    testDb.raw.prepare(
      `INSERT INTO automation_definitions
         (id, line_account_id, name, status, created_at, updated_at)
       VALUES ('draft-only', 'account-1', '下書きだけ', 'draft', datetime('now'), datetime('now'))`,
    ).run();
    await expect(createAutomationDraftFromDefinition(testDb.db, {
      id: 'archived-one', lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'not_found' });
    await expect(createAutomationDraftFromDefinition(testDb.db, {
      id: 'draft-only', lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'not_found' });
    await expect(createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-2',
    })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('複製は「のコピー」の新しい下書きを作り、共通アクションの束も写す', async () => {
    addActiveDefinition(testDb.raw);
    testDb.raw.prepare(
      `INSERT INTO common_actions (id, line_account_id, name, status)
       VALUES ('ca-1', 'account-1', '会員向け一式', 'published')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO common_action_versions
         (id, common_action_id, version_number, status, action_config, published_at)
       VALUES ('cv-1', 'ca-1', 1, 'published', '[]', datetime('now'))`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO common_action_bindings
         (id, line_account_id, common_action_id, common_action_version_id,
          consumer_type, consumer_id, consumer_path)
       VALUES ('bind-1', 'account-1', 'ca-1', 'cv-1', 'automation', 'auto-1', 'step-1')`,
    ).run();

    const created = await duplicateAutomationDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1', createdBy: 'staff-1',
    });
    expect(created.id).not.toBe('auto-1');

    const copied = testDb.raw.prepare(
      `SELECT name, status FROM automation_definitions WHERE id = ?`,
    ).get(created.id);
    expect(copied).toEqual({ name: '予約後フォロー のコピー', status: 'draft' });
    const draft = await getAutomationDraft(testDb.db, {
      id: created.id, lineAccountId: 'account-1',
    });
    expect(draft).toMatchObject({
      eventType: 'tag_change',
      actions: [{ type: 'common_action', params: { commonActionId: 'ca-1' } }],
    });
    // 束は新しい定義へ付け替え、版の固定（cv-1）は引き継ぐ。
    expect(testDb.raw.prepare(
      `SELECT consumer_id, common_action_version_id FROM common_action_bindings
        WHERE consumer_type = 'automation' AND consumer_id = ?`,
    ).get(created.id)).toEqual({ consumer_id: created.id, common_action_version_id: 'cv-1' });
  });

  it('束が2件以上ある定義も複製でき、束は新しい定義へ1件ずつ写る', async () => {
    /*
     * 同じidで束をまとめてINSERTすると PRIMARY KEY 衝突で500になった。
     * 束ごとに新しいidを振る回帰を固定する。
     */
    addActiveDefinition(testDb.raw);
    testDb.raw.prepare(
      `INSERT INTO common_actions (id, line_account_id, name, status)
       VALUES ('ca-1', 'account-1', '会員向け一式', 'published'),
              ('ca-2', 'account-1', '来店後の案内', 'published')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO common_action_versions
         (id, common_action_id, version_number, status, action_config, published_at)
       VALUES ('cv-1', 'ca-1', 1, 'published', '[]', datetime('now')),
              ('cv-2', 'ca-2', 2, 'published', '[]', datetime('now'))`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO common_action_bindings
         (id, line_account_id, common_action_id, common_action_version_id,
          consumer_type, consumer_id, consumer_path)
       VALUES ('bind-1', 'account-1', 'ca-1', 'cv-1', 'automation', 'auto-1', 'step-1'),
              ('bind-2', 'account-1', 'ca-2', 'cv-2', 'automation', 'auto-1', 'step-2')`,
    ).run();

    const created = await duplicateAutomationDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1', createdBy: 'staff-1',
    });
    const bindings = testDb.raw.prepare(
      `SELECT id, consumer_id, common_action_id, common_action_version_id, consumer_path
         FROM common_action_bindings
        WHERE consumer_type = 'automation' AND consumer_id = ?
        ORDER BY consumer_path`,
    ).all(created.id) as Array<{
      id: string; consumer_id: string; common_action_id: string;
      common_action_version_id: string; consumer_path: string;
    }>;
    expect(bindings).toEqual([
      { id: expect.any(String), consumer_id: created.id, common_action_id: 'ca-1',
        common_action_version_id: 'cv-1', consumer_path: 'step-1' },
      { id: expect.any(String), consumer_id: created.id, common_action_id: 'ca-2',
        common_action_version_id: 'cv-2', consumer_path: 'step-2' },
    ]);
    // 写された束のidは元と別で、互いにも重ならない。
    expect(new Set(bindings.map((row) => row.id)).size).toBe(2);
    expect(bindings.map((row) => row.id)).not.toContain('bind-1');
    expect(bindings.map((row) => row.id)).not.toContain('bind-2');
  });

  it('保管済みと別アカウントの定義は複製できない', async () => {
    addActiveDefinition(testDb.raw, { id: 'archived-one', status: 'archived' });
    await expect(duplicateAutomationDefinition(testDb.db, {
      id: 'archived-one', lineAccountId: 'account-1',
    })).rejects.toMatchObject({ code: 'not_found' });
    await expect(duplicateAutomationDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-2',
    })).rejects.toMatchObject({ code: 'not_found' });
  });
});
