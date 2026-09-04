import type Database from 'better-sqlite3';
import type { Message } from '@line-crm/line-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { createAutomationActionExecutors } from './automation-action-executors';
import { processAutomationRun, startAutomationRun, type ActionDefinition } from './automation-engine';

const NOW = '2026-08-26T05:00:00.000Z';

function addAccount(raw: Database.Database, id: string): void {
  raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', '本部')`).run();
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES (?, ?, ?, '', '', 1, 'tenant-1')`,
  ).run(id, `channel-${id}`, id);
}

function addFriend(raw: Database.Database, id: string, accountId: string): void {
  raw.prepare(
    `INSERT INTO friends
       (id, line_user_id, display_name, line_account_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?)`,
  ).run(id, `U-${id}`, id, accountId, NOW, NOW);
}

function addAutomation(
  raw: Database.Database,
  accountId: string,
  action: ActionDefinition,
): { automationId: string } {
  const automationId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  raw.prepare(
    `INSERT INTO automation_definitions
       (id, line_account_id, name, status) VALUES (?, ?, '接続テスト', 'active')`,
  ).run(automationId, accountId);
  raw.prepare(
    `INSERT INTO automation_versions
       (id, automation_id, version_number, status, trigger_type, action_config, published_at)
     VALUES (?, ?, 1, 'published', 'friend_add', ?, ?)`,
  ).run(versionId, automationId, JSON.stringify([action]), NOW);
  raw.prepare(
    `UPDATE automation_definitions SET current_published_version_id = ? WHERE id = ?`,
  ).run(versionId, automationId);
  return { automationId };
}

async function execute(
  testDb: SqliteD1,
  input: {
    accountId: string;
    friendId: string;
    action: ActionDefinition;
    executors?: ReturnType<typeof createAutomationActionExecutors>;
  },
) {
  const setup = addAutomation(testDb.raw, input.accountId, input.action);
  const started = await startAutomationRun(testDb.db, {
    lineAccountId: input.accountId,
    automationId: setup.automationId,
    friendId: input.friendId,
    sourceEventId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    inputEvent: { type: 'friend_add' },
    conditionMatched: true,
    now: NOW,
  });
  const status = await processAutomationRun(testDb.db, started.runId!, {
    now: NOW,
    executors: input.executors ?? createAutomationActionExecutors(),
  });
  return { ...started, status };
}

describe('V6オートメーションの既存処理接続', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
    addFriend(testDb.raw, 'friend-1', 'account-1');
    addFriend(testDb.raw, 'friend-2', 'account-2');
  });

  it('同じアカウントのタグだけを付け、繰り返しても重複しない', async () => {
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'account-1')`,
    ).run();
    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: { id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' },
    });

    expect(result.status).toBe('success');
    expect(testDb.raw.prepare(`SELECT friend_id, tag_id FROM friend_tags`).all())
      .toEqual([{ friend_id: 'friend-1', tag_id: 'tag-1' }]);
  });

  it('別アカウントのタグを指定すると更新せず失敗する', async () => {
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id) VALUES ('tag-2', '他店', 'account-2')`,
    ).run();
    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: { id: 'tag', type: 'add_tag', params: { tagId: 'tag-2' }, onFailure: 'stop' },
    });

    expect(result.status).toBe('failed');
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM friend_tags`).get()).toEqual({ count: 0 });
    expect(testDb.raw.prepare(
      `SELECT error_code FROM automation_run_steps WHERE automation_run_id = ? AND step_key = 'tag'`,
    ).get(result.runId)).toEqual({ error_code: 'tag_not_found' });
  });

  it('対応マークを変更し、変更前後と自動変更の根拠を監査へ残す', async () => {
    testDb.raw.prepare(
      `INSERT INTO support_marks (id, name, color) VALUES ('mark-working', '対応中', '#3B82F6')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
       VALUES ('mark-working', 'tenant-1', 'account-1', datetime('now'))`,
    ).run();
    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'mark', type: 'set_support_mark',
        params: { markId: 'mark-working', manualProtectionMinutes: 0 }, onFailure: 'stop',
      },
    });

    expect(result.status).toBe('success');
    expect(testDb.raw.prepare(`SELECT support_mark_id FROM friends WHERE id = 'friend-1'`).get())
      .toEqual({ support_mark_id: 'mark-working' });
    const audit = testDb.raw.prepare(
      `SELECT actor_id, detail_json FROM operation_audit WHERE friend_id = 'friend-1'`,
    ).get() as { actor_id: string | null; detail_json: string };
    expect(audit.actor_id).toBeNull();
    expect(JSON.parse(audit.detail_json)).toMatchObject({
      beforeMarkId: null,
      afterMarkId: 'mark-working',
      source: 'automation',
    });
  });

  it('手で変更した直後は保護時間が切れるまで自動変更で上書きしない', async () => {
    testDb.raw.prepare(
      `INSERT INTO support_marks (id, name, color) VALUES ('mark-protected', '確認中', '#F59E0B')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
       VALUES ('mark-protected', 'tenant-1', 'account-1', datetime('now'))`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_audit
         (id, target_kind, target_id, action, actor_id, friend_id, created_at)
       VALUES ('audit-manual', 'support_mark', NULL, 'changed', 'staff-1', 'friend-1', ?)`,
    ).run(NOW);

    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'mark', type: 'set_support_mark',
        params: { markId: 'mark-protected', manualProtectionMinutes: 60 }, onFailure: 'stop',
      },
      executors: createAutomationActionExecutors({ now: () => NOW }),
    });

    expect(result.status).toBe('success');
    expect(testDb.raw.prepare(`SELECT support_mark_id FROM friends WHERE id = 'friend-1'`).get())
      .toEqual({ support_mark_id: null });
  });

  it('手動変更の保護時間が切れた後は自動変更を再開する', async () => {
    testDb.raw.prepare(
      `INSERT INTO support_marks (id, name, color) VALUES ('mark-resumed', '対応再開', '#10B981')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
       VALUES ('mark-resumed', 'tenant-1', 'account-1', datetime('now'))`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_audit
         (id, target_kind, target_id, action, actor_id, friend_id, created_at)
       VALUES ('audit-manual-expired', 'support_mark', NULL, 'changed', 'staff-1', 'friend-1', ?)`,
    ).run(NOW);

    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'mark', type: 'set_support_mark',
        params: { markId: 'mark-resumed', manualProtectionMinutes: 60 }, onFailure: 'stop',
      },
      executors: createAutomationActionExecutors({
        now: () => '2026-08-26T06:01:00.000Z',
      }),
    });

    expect(result.status).toBe('success');
    expect(testDb.raw.prepare(`SELECT support_mark_id FROM friends WHERE id = 'friend-1'`).get())
      .toEqual({ support_mark_id: 'mark-resumed' });
  });

  it('友だち情報を同じアカウントの対象だけ更新する', async () => {
    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'metadata', type: 'set_metadata',
        params: { values: { plan: 'premium', visits: 3 } }, onFailure: 'stop',
      },
    });

    expect(result.status).toBe('success');
    expect(JSON.parse((testDb.raw.prepare(`SELECT metadata FROM friends WHERE id = 'friend-1'`).get() as { metadata: string }).metadata))
      .toEqual({ plan: 'premium', visits: 3 });
    expect(JSON.parse((testDb.raw.prepare(`SELECT metadata FROM friends WHERE id = 'friend-2'`).get() as { metadata: string }).metadata))
      .toEqual({});
  });

  it('友だち情報の{{message}}を発生イベントの本文に置き換える', async () => {
    const setup = addAutomation(testDb.raw, 'account-1', {
      id: 'metadata-message', type: 'set_metadata',
      params: { data: '{"last_message":"{{message}}"}' }, onFailure: 'stop',
    });
    const started = await startAutomationRun(testDb.db, {
      lineAccountId: 'account-1', automationId: setup.automationId, friendId: 'friend-1',
      sourceEventId: 'message-event', idempotencyKey: crypto.randomUUID(),
      inputEvent: { text: '予約を変更したいです' }, conditionMatched: true, now: NOW,
    });
    expect(await processAutomationRun(testDb.db, started.runId!, {
      now: NOW, executors: createAutomationActionExecutors(),
    })).toBe('success');
    const row = testDb.raw.prepare(`SELECT metadata FROM friends WHERE id = 'friend-1'`)
      .get() as { metadata: string };
    expect(JSON.parse(row.metadata)).toEqual({ last_message: '予約を変更したいです' });
  });

  it('同じアカウントで動作中のシナリオだけを開始する', async () => {
    testDb.raw.prepare(
      `INSERT INTO scenarios
         (id, name, trigger_type, is_active, delivery_mode, line_account_id, allow_concurrent)
       VALUES ('scenario-1', '案内', 'manual', 1, 'relative', 'account-1', 1)`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO scenario_steps
         (id, scenario_id, step_order, delay_minutes, message_type, message_content)
       VALUES ('scenario-step-1', 'scenario-1', 1, 0, 'text', '案内です')`,
    ).run();
    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'scenario', type: 'start_scenario',
        params: { scenarioId: 'scenario-1' }, onFailure: 'stop',
      },
    });

    expect(result.status).toBe('success');
    expect(testDb.raw.prepare(
      `SELECT friend_id, scenario_id, status FROM friend_scenarios`,
    ).all()).toEqual([{ friend_id: 'friend-1', scenario_id: 'scenario-1', status: 'active' }]);
  });

  it('配信ステップがないシナリオは開始しない', async () => {
    testDb.raw.prepare(
      `INSERT INTO scenarios
         (id, name, trigger_type, is_active, delivery_mode, line_account_id, allow_concurrent)
       VALUES ('scenario-empty', '空の案内', 'manual', 1, 'relative', 'account-1', 1)`,
    ).run();

    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'scenario-empty', type: 'start_scenario',
        params: { scenarioId: 'scenario-empty' }, onFailure: 'stop',
      },
    });

    expect(result.status).toBe('failed');
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM friend_scenarios`).get())
      .toEqual({ count: 0 });
  });

  it('LINE送信へ処理実行IDを冪等キーとして渡し、送信記録と予約を同時に完了する', async () => {
    const pushMessage = vi.fn(async (
      _to: string,
      _messages: Message[],
      _retryKey?: string,
    ) => ({ requestId: 'line-request-1' }));
    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'message', type: 'send_message',
        params: { messageType: 'text', content: 'こんにちは' }, onFailure: 'stop',
      },
      executors: createAutomationActionExecutors({
        resolveLineAccessToken: async () => 'token-1',
        createLineClient: () => ({
          pushMessage,
          linkRichMenuToUser: vi.fn(),
          unlinkRichMenuFromUser: vi.fn(),
        }),
        now: () => NOW,
      }),
    });

    expect(result.status).toBe('success');
    expect(pushMessage).toHaveBeenCalledTimes(1);
    const retryKey = pushMessage.mock.calls[0]?.[2];
    const step = testDb.raw.prepare(
      `SELECT id FROM automation_run_steps WHERE automation_run_id = ? AND step_key = 'message'`,
    ).get(result.runId) as { id: string };
    expect(retryKey).toBe(step.id);
    expect(testDb.raw.prepare(
      `SELECT status, response_id FROM outbound_send_requests WHERE idempotency_key = ?`,
    ).get(step.id)).toEqual({ status: 'succeeded', response_id: 'line-request-1' });
    expect(testDb.raw.prepare(
      `SELECT content, source, line_account_id FROM messages_log WHERE friend_id = 'friend-1'`,
    ).get()).toEqual({ content: 'こんにちは', source: 'automation_v6', line_account_id: 'account-1' });
  });

  it('LINEの5xxは再試行、認証エラーは即時失敗に分ける', async () => {
    const lineClient = (message: string) => ({
      pushMessage: vi.fn(async () => { throw new Error(message); }),
      linkRichMenuToUser: vi.fn(),
      unlinkRichMenuFromUser: vi.fn(),
    });
    const temporary = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: { id: 'temporary', type: 'send_message', params: { content: 'A' }, onFailure: 'stop' },
      executors: createAutomationActionExecutors({
        resolveLineAccessToken: async () => 'token-1',
        createLineClient: () => lineClient('LINE API error: 500 Internal Server Error'),
      }),
    });
    const rejected = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: { id: 'rejected', type: 'send_message', params: { content: 'B' }, onFailure: 'stop' },
      executors: createAutomationActionExecutors({
        resolveLineAccessToken: async () => 'token-1',
        createLineClient: () => lineClient('LINE API error: 401 Unauthorized'),
      }),
    });

    expect(temporary.status).toBe('waiting');
    expect(rejected.status).toBe('failed');
  });

  it('Webhookは登録済みのHTTPSだけへ冪等キー付きで送り、5xxを再試行にする', async () => {
    testDb.raw.prepare(
      `INSERT INTO outgoing_webhooks
         (id, name, url, event_types, is_active, line_account_id)
       VALUES ('webhook-1', 'CRM', 'https://hooks.example.com/events', '[]', 1, 'account-1')`,
    ).run();
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response('', { status: 503 }));
    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'webhook', type: 'send_webhook', params: { webhookId: 'webhook-1' }, onFailure: 'stop',
      },
      executors: createAutomationActionExecutors({ fetch: fetchMock as typeof fetch }),
    });

    expect(result.status).toBe('waiting');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const step = testDb.raw.prepare(
      `SELECT id FROM automation_run_steps WHERE automation_run_id = ? AND step_key = 'webhook'`,
    ).get(result.runId) as { id: string };
    expect(headers['Idempotency-Key']).toBe(step.id);
  });

  it('別アカウントのWebhookと安全でないURLを送らない', async () => {
    testDb.raw.prepare(
      `INSERT INTO outgoing_webhooks
         (id, name, url, event_types, is_active, line_account_id)
       VALUES ('other-hook', '他店', 'https://hooks.example.com/events', '[]', 1, 'account-2'),
              ('local-hook', '内部', 'https://[::1]/private', '[]', 1, 'account-1')`,
    ).run();
    const fetchMock = vi.fn();
    const other = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: { id: 'other', type: 'send_webhook', params: { webhookId: 'other-hook' }, onFailure: 'stop' },
      executors: createAutomationActionExecutors({ fetch: fetchMock as typeof fetch }),
    });
    const local = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: { id: 'local', type: 'send_webhook', params: { webhookId: 'local-hook' }, onFailure: 'stop' },
      executors: createAutomationActionExecutors({ fetch: fetchMock as typeof fetch }),
    });

    expect(other.status).toBe('failed');
    expect(local.status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('同じアカウントで公開済みのリッチメニューだけを切り替える', async () => {
    testDb.raw.prepare(
      `INSERT INTO rich_menu_groups
         (id, account_id, name, chat_bar_text, size, status)
       VALUES ('menu-group', 'account-1', '会員', 'メニュー', 'large', 'published')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO rich_menu_pages
         (id, group_id, order_index, name, alias_id, line_richmenu_id)
       VALUES ('menu-page', 'menu-group', 0, 'トップ', 'alias-1', 'line-menu-1')`,
    ).run();
    const link = vi.fn(async () => undefined);
    const result = await execute(testDb, {
      accountId: 'account-1', friendId: 'friend-1',
      action: {
        id: 'menu', type: 'switch_rich_menu', params: { richMenuPageId: 'menu-page' }, onFailure: 'stop',
      },
      executors: createAutomationActionExecutors({
        resolveLineAccessToken: async () => 'token-1',
        createLineClient: () => ({
          pushMessage: vi.fn(), linkRichMenuToUser: link, unlinkRichMenuFromUser: vi.fn(),
        }),
      }),
    });

    expect(result.status).toBe('success');
    expect(link).toHaveBeenCalledWith('U-friend-1', 'line-menu-1');
  });
});
