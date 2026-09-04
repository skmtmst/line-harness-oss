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
      triggerConfig: { tagId: 'tag-1', action: 'add' },
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
    })).rejects.toMatchObject({ code: 'resource_not_found', field: 'actionTagId' });
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
    })).rejects.toMatchObject({ code: 'resource_not_found', field: 'actionScenarioId' });
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
