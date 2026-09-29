import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  automationRevisionToken,
  createAutomationDraftFromDefinition,
  publishAutomationDraft,
} from './automation-drafts';
import { runAutomationTest, updateAutomationDefinitionStatus } from './automation-definitions';

function addAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, timezone)
     VALUES (?, ?, ?, '', '', 1, 'Asia/Tokyo')`,
  ).run(id, `channel-${id}`, id);
}

function addFriend(raw: Database.Database, id: string, accountId: string): void {
  raw.prepare(
    `INSERT INTO friends
       (id, line_user_id, display_name, line_account_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', datetime('now'), datetime('now'))`,
  ).run(id, `U-${id}`, id, accountId);
}

function addPublishedDefinition(raw: Database.Database, id: string): string {
  const versionId = `${id}-v1`;
  raw.prepare(
    `INSERT INTO automation_definitions
       (id, line_account_id, name, status, priority, created_at, updated_at)
     VALUES (?, 'account-1', ?, 'active', 10, datetime('now'), datetime('now'))`,
  ).run(id, id);
  raw.prepare(
    `INSERT INTO automation_versions
       (id, automation_id, version_number, status, trigger_type, trigger_config,
        condition_config, action_config, created_at, published_at)
     VALUES (?, ?, 1, 'published', 'message_received', '{}', '{}', ?, datetime('now'), datetime('now'))`,
  ).run(versionId, id, JSON.stringify([{ id: 'step-1', type: 'send_message', params: { messageType: 'text', content: 'こんにちは' }, onFailure: 'stop' }]));
  raw.prepare(
    `UPDATE automation_definitions
        SET current_published_version_id = ?
      WHERE id = ?`,
  ).run(versionId, id);
  return versionId;
}

async function testRevisionOf(raw: Database.Database, versionId: string): Promise<string> {
  const row = raw.prepare(
    `SELECT trigger_type, trigger_config, condition_config, action_config
       FROM automation_versions WHERE id = ?`,
  ).get(versionId) as {
    trigger_type: string; trigger_config: string; condition_config: string; action_config: string;
  };
  return automationRevisionToken(versionId, row);
}

describe('R483: 公開の読み取り後に稼働状態が変わったら上書きしない', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
  });

  it('公開の読み取り後に停止が成功したら、公開は409で止まり停止のまま', async () => {
    addPublishedDefinition(testDb.raw, 'auto-1');
    // 公開する側は active の状態で改訂下書きを読む。
    const draft = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
    });
    // 読み取り後に別の担当が停止を成功させる。
    await updateAutomationDefinitionStatus(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1', status: 'stopped',
    });
    // 読み取り時点の active で公開しようとしても通さない。
    await expect(publishAutomationDraft(testDb.db, {
      id: 'auto-1', lineAccountId: 'account-1',
      expectedDraftVersionId: draft.draftVersionId, activate: true,
      expectedStatus: 'active',
    })).rejects.toMatchObject({ code: 'version_conflict' });
    // 停止が取り消されていない。
    const row = testDb.raw.prepare(
      `SELECT status FROM automation_definitions WHERE id = 'auto-1'`,
    ).get() as { status: string };
    expect(row.status).toBe('stopped');
  });

  it('逆方向（停止→公開読取→再開）でも最新の状態変更を失わない', async () => {
    addPublishedDefinition(testDb.raw, 'auto-2');
    await updateAutomationDefinitionStatus(testDb.db, {
      id: 'auto-2', lineAccountId: 'account-1', status: 'stopped',
    });
    // 公開する側は stopped の状態で改訂下書きを読む。
    const draft = await createAutomationDraftFromDefinition(testDb.db, {
      id: 'auto-2', lineAccountId: 'account-1',
    });
    // 読み取り後に別の担当が再開を成功させる。
    await updateAutomationDefinitionStatus(testDb.db, {
      id: 'auto-2', lineAccountId: 'account-1', status: 'active',
    });
    await expect(publishAutomationDraft(testDb.db, {
      id: 'auto-2', lineAccountId: 'account-1',
      expectedDraftVersionId: draft.draftVersionId, activate: true,
      expectedStatus: 'stopped',
    })).rejects.toMatchObject({ code: 'version_conflict' });
    const row = testDb.raw.prepare(
      `SELECT status FROM automation_definitions WHERE id = 'auto-2'`,
    ).get() as { status: string };
    expect(row.status).toBe('active');
  });
});

describe('R484: 同じ確認の再試行は実行を1件に保つ', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addFriend(testDb.raw, 'friend-1', 'account-1');
  });

  it('同じ要求キーでの再試行は初回の実行を返し、実行は1件だけ', async () => {
    const versionId = addPublishedDefinition(testDb.raw, 'auto-3');
    const input = {
      automationId: 'auto-3',
      versionId: await testRevisionOf(testDb.raw, versionId),
      friendId: 'friend-1',
      lineAccountId: 'account-1',
      operationKey: 'test-confirm-1',
    };
    const first = await runAutomationTest(testDb.db, input);
    // 応答が失われたものとして、同じ鍵でもう一度呼ぶ。
    const second = await runAutomationTest(testDb.db, input);
    expect(second.runId).toBe(first.runId);
    const rows = testDb.raw.prepare(
      `SELECT COUNT(*) AS count FROM automation_runs
        WHERE line_account_id = 'account-1' AND automation_id = 'auto-3'`,
    ).get() as { count: number };
    expect(rows.count).toBe(1);
  });

  it('鍵が違えば新しい確認として別に実行する', async () => {
    const versionId = addPublishedDefinition(testDb.raw, 'auto-4');
    const base = {
      automationId: 'auto-4',
      versionId: await testRevisionOf(testDb.raw, versionId),
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    };
    const first = await runAutomationTest(testDb.db, { ...base, operationKey: 'test-confirm-a' });
    const second = await runAutomationTest(testDb.db, { ...base, operationKey: 'test-confirm-b' });
    expect(second.runId).not.toBe(first.runId);
  });
});
