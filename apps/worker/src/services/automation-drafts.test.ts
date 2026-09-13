import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  createAutomationDraftFromTemplate,
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

  it('選んだアカウントのタグと稼働中シナリオだけを返す', async () => {
    expect(await listAutomationDraftResources(testDb.db, 'account-1')).toEqual({
      tags: [{ id: 'tag-1', name: '予約' }],
      scenarios: [{ id: 'scenario-1', name: '予約後' }],
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
      templateKey: 'received-message-tag', lineAccountId: 'account-1', createdBy: 'staff-1',
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
      templateKey: 'received-message-tag', lineAccountId: 'account-1', createdBy: 'staff-1',
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

describe('見本からの下書き作成は何度呼んでも1件（#679 A3）', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
  });

  const create = (accountId: string, createdBy: string | null = 'staff-1') =>
    createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag',
      lineAccountId: accountId,
      createdBy,
    });

  it('別タブが同時に押しても下書きは1件で、同じ札を返す', async () => {
    // 以前は毎回 crypto.randomUUID() を振っていたので2件できた。
    const [first, second] = await Promise.all([create('account-1'), create('account-1')]);
    expect(second.id).toBe(first.id);
    expect(second.draftVersionId).toBe(first.draftVersionId);
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS count FROM automation_definitions WHERE line_account_id = 'account-1'",
    ).get()).toEqual({ count: 1 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_versions').get())
      .toEqual({ count: 1 });
  });

  it('店が違えば別の下書きになる', async () => {
    const first = await create('account-1');
    const second = await create('account-2');
    expect(second.id).not.toBe(first.id);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM automation_definitions').get())
      .toEqual({ count: 2 });
  });

  it('担当者が違えば別の下書きになる', async () => {
    const first = await create('account-1', 'staff-1');
    const second = await create('account-1', 'staff-2');
    expect(second.id).not.toBe(first.id);
  });

  it('前の下書きを公開したあとは、新しい下書きを作る', async () => {
    const first = await create('account-1');
    testDb.raw.prepare(
      "UPDATE automation_definitions SET status = 'active' WHERE id = ?",
    ).run(first.id);
    const second = await create('account-1');
    expect(second.id).not.toBe(first.id);
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS count FROM automation_definitions WHERE status = 'draft'",
    ).get()).toEqual({ count: 1 });
  });
});
