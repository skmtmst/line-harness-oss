import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFriendBulkRunDetail } from '@line-crm/db';
import { AutomationActionError, type AutomationActionExecutor } from './automation-engine';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  createFriendBulkUndoRun,
  previewFriendBulkRun,
  processFriendBulkRun,
  retryFriendBulkRun,
  startFriendBulkRun,
} from './friend-bulk-runs';

const NOW = '2026-08-31T02:00:00.000Z';
const LATER = '2026-08-31T02:02:00.000Z';
const staff = {
  id: 'env-owner',
  name: '管理者',
  role: 'owner' as const,
  readOnly: false,
  tenantId: 'default',
};

function addAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES (?, ?, ?, '', '', 1, 'default')`,
  ).run(id, `channel-${id}`, id);
}

describe('V6 友だち一括操作', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
    insertFriend(testDb.raw, 'friend-1', { line_account_id: 'account-1', is_following: 1 });
    insertFriend(testDb.raw, 'friend-2', { line_account_id: 'account-1', is_following: 0 });
    insertFriend(testDb.raw, 'friend-3', { line_account_id: 'account-2', is_following: 1 });
  });

  it('対象をサーバで再計算し、送れない人と別アカウントを理由付きで除外する', async () => {
    testDb.raw.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
       VALUES ('template-1', 'お知らせ', 'text', '本文', 'account-1')`,
    ).run();
    const result = await previewFriendBulkRun(testDb.db, staff, {
      kind: 'explicit', friendIds: ['friend-1', 'friend-2', 'friend-3'],
    }, {
      kind: 'send_message', templateId: 'template-1',
    });

    expect(result.preview).toMatchObject({ selectedCount: 3, targetCount: 1, excludedCount: 2 });
    expect(result.preview.exclusions).toEqual(expect.arrayContaining([
      { reason: '現在はLINEで送信できません', count: 1 },
      { reason: '選んだ操作とLINE公式アカウントが異なります', count: 1 },
    ]));
    expect(result.targets).toEqual([{ friendId: 'friend-1', lineAccountId: 'account-1' }]);
  });

  it('対象IDを固定してタグを冪等実行し、あとから増えた友だちは触らない', async () => {
    testDb.raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`).run();
    const created = await startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1'] },
      operation: { kind: 'add_tag', tagId: 'tag-1' },
      idempotencyKey: crypto.randomUUID(),
      now: NOW,
    });
    insertFriend(testDb.raw, 'friend-late', { line_account_id: 'account-1', is_following: 1 });

    expect(await processFriendBulkRun(testDb.db, created.run.id, { now: NOW })).toMatchObject({ status: 'success' });
    expect(testDb.raw.prepare(`SELECT friend_id, tag_id FROM friend_tags`).all())
      .toEqual([{ friend_id: 'friend-1', tag_id: 'tag-1' }]);

    expect(await processFriendBulkRun(testDb.db, created.run.id, { now: NOW })).toMatchObject({ processed: 0 });
    expect(testDb.raw.prepare(`SELECT attempt_count FROM friend_bulk_run_items`).get())
      .toEqual({ attempt_count: 1 });
  });

  it('同じ冪等キーの同じ内容は同じ実行を返し、異なる内容は拒否する', async () => {
    testDb.raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`).run();
    const key = crypto.randomUUID();
    const first = await startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1'] },
      operation: { kind: 'add_tag', tagId: 'tag-1' }, idempotencyKey: key, now: NOW,
    });
    const replay = await startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1'] },
      operation: { kind: 'add_tag', tagId: 'tag-1' }, idempotencyKey: key, now: NOW,
    });
    expect(replay.created).toBe(false);
    expect(replay.run.id).toBe(first.run.id);

    await expect(startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1'] },
      operation: { kind: 'remove_tag', tagId: 'tag-1' }, idempotencyKey: key, now: NOW,
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });

  it('実行結果は全件を一度に返さず、総数を保ったままページで読む', async () => {
    testDb.raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`).run();
    insertFriend(testDb.raw, 'friend-4', { line_account_id: 'account-1', is_following: 1 });
    const created = await startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1', 'friend-2', 'friend-4'] },
      operation: { kind: 'add_tag', tagId: 'tag-1' },
      idempotencyKey: crypto.randomUUID(), now: NOW,
    });

    const detail = await getFriendBulkRunDetail(testDb.db, created.run.id, 'default', { page: 2, limit: 2 });
    expect(detail).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(detail?.items.map((item) => item.friendId)).toEqual(['friend-4']);
  });

  it('一時失敗だけを明示的な再試行でやり直す', async () => {
    const key = crypto.randomUUID();
    const created = await startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1'] },
      operation: { kind: 'send_message', content: 'こんにちは' },
      idempotencyKey: key,
      confirmIrreversible: true,
      now: NOW,
    });
    const send = vi.fn<AutomationActionExecutor>()
      .mockRejectedValueOnce(new AutomationActionError('line_busy', 'ただいま送信が混み合っています', true))
      .mockResolvedValueOnce(undefined);

    expect(await processFriendBulkRun(testDb.db, created.run.id, {
      now: NOW, executors: { send_message: send },
    })).toMatchObject({ status: 'failed' });
    expect(testDb.raw.prepare(`SELECT status FROM friend_bulk_run_items`).get())
      .toEqual({ status: 'temporary_failure' });

    expect(await retryFriendBulkRun(testDb.db, created.run.id, 'default', LATER)).toBe(1);
    expect(await processFriendBulkRun(testDb.db, created.run.id, {
      now: LATER, executors: { send_message: send },
    })).toMatchObject({ status: 'success' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('一括送信を通常の自動処理と取り違えない送信元で記録する', async () => {
    const created = await startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1'] },
      operation: { kind: 'send_message', content: '一括のお知らせ' },
      idempotencyKey: crypto.randomUUID(), confirmIrreversible: true, now: NOW,
    });
    await processFriendBulkRun(testDb.db, created.run.id, {
      now: NOW,
      executorDependencies: {
        resolveLineAccessToken: async () => 'token',
        createLineClient: () => ({
          pushMessage: async () => ({ requestId: 'request-1' }),
          linkRichMenuToUser: async () => undefined,
          unlinkRichMenuFromUser: async () => undefined,
        }),
        now: () => NOW,
      },
    });

    expect(testDb.raw.prepare(
      `SELECT content, source FROM messages_log WHERE friend_id = 'friend-1'`,
    ).get()).toEqual({ content: '一括のお知らせ', source: 'friend_bulk_run' });
  });

  it('共通アクションの公開版を固定し、待機後に続きから再開する', async () => {
    testDb.raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`).run();
    testDb.raw.prepare(
      `INSERT INTO common_actions (id, line_account_id, name, status, current_published_version_id, created_at, updated_at)
       VALUES ('action-1', 'account-1', '待ってタグ', 'published', 'version-1', ?, ?)`,
    ).run(NOW, NOW);
    testDb.raw.prepare(
      `INSERT INTO common_action_versions
         (id, common_action_id, version_number, status, action_config, created_at, published_at)
       VALUES ('version-1', 'action-1', 1, 'published', ?, ?, ?)`,
    ).run(JSON.stringify([
      { id: 'wait', type: 'wait', params: { durationMinutes: 1 }, onFailure: 'stop' },
      { id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' },
    ]), NOW, NOW);
    const created = await startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1'] },
      operation: { kind: 'run_common_action', commonActionId: 'action-1' },
      idempotencyKey: crypto.randomUUID(), confirmIrreversible: true, now: NOW,
    });

    expect(await processFriendBulkRun(testDb.db, created.run.id, { now: NOW })).toMatchObject({ status: 'waiting' });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM friend_tags`).get()).toEqual({ count: 0 });
    expect(await processFriendBulkRun(testDb.db, created.run.id, { now: LATER })).toMatchObject({ status: 'success' });
    expect(testDb.raw.prepare(`SELECT friend_id, tag_id FROM friend_tags`).all())
      .toEqual([{ friend_id: 'friend-1', tag_id: 'tag-1' }]);
  });

  it('可逆操作は元の値から別の取り消し実行を作る', async () => {
    const created = await startFriendBulkRun(testDb.db, staff, {
      selection: { kind: 'explicit', friendIds: ['friend-1'] },
      operation: { kind: 'set_visibility', hidden: true },
      idempotencyKey: crypto.randomUUID(), now: NOW,
    });
    await processFriendBulkRun(testDb.db, created.run.id, { now: NOW });
    expect(testDb.raw.prepare(`SELECT is_hidden FROM friends WHERE id = 'friend-1'`).get()).toEqual({ is_hidden: 1 });

    const undo = await createFriendBulkUndoRun(testDb.db, staff, created.run.id, crypto.randomUUID(), LATER);
    await processFriendBulkRun(testDb.db, undo.run.id, { now: LATER });
    expect(testDb.raw.prepare(`SELECT is_hidden FROM friends WHERE id = 'friend-1'`).get()).toEqual({ is_hidden: 0 });
  });
});
