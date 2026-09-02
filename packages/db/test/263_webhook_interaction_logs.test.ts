import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  claimWebhookInteractionRetry,
  createWebhookInteraction,
  finishWebhookInteraction,
  getWebhookInteractionById,
  listFailedWebhookInteractionsForRetry,
  listWebhookInteractions,
  restoreWebhookInteractionFailure,
} from '../src/webhooks.js';
import { asD1 } from './d1-test-helper.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '263_webhook_interaction_logs.sql'),
  'utf8',
);

describe('migration 263 Webhookやり取り記録', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
    `);
    sqlite.exec(migration);
    db = asD1(sqlite);
  });

  it('接続先URLとシークレットの列を持たず、アカウント単位の索引を作る', () => {
    const columns = sqlite.prepare("PRAGMA table_info('webhook_interaction_logs')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining(['url', 'secret']));
    expect(sqlite.prepare("PRAGMA index_list('webhook_interaction_logs')").all())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'idx_webhook_interactions_account_created' }),
        expect.objectContaining({ name: 'idx_webhook_interactions_account_status' }),
      ]));
  });

  it('別アカウントの記録を一覧にも単一取得にも混ぜない', async () => {
    const accountA = await createWebhookInteraction(db, {
      id: 'run-a',
      lineAccountId: 'account-a',
      direction: 'outgoing',
      webhookId: 'webhook-a',
      webhookName: '顧客管理',
      eventType: 'friend.added',
      triggerSummary: '友だちが追加されたとき',
      requestBodyJson: '{"friend":"secret"}',
      idempotencyKey: 'delivery-a',
    });
    await createWebhookInteraction(db, {
      id: 'run-b',
      lineAccountId: 'account-b',
      direction: 'incoming',
      webhookName: '受注管理',
      eventType: 'incoming_webhook.order',
      triggerSummary: '注文を受け取ったとき',
      idempotencyKey: 'delivery-b',
    });
    await finishWebhookInteraction(db, accountA.id, 'account-a', {
      status: 'succeeded', responseStatus: 200, attemptCount: 1, durationMs: 380,
    });

    const result = await listWebhookInteractions(db, { lineAccountId: 'account-a' });
    expect(result.items.map((item) => item.id)).toEqual(['run-a']);
    expect(result.summary).toMatchObject({ total: 1, outgoing: 1, incoming: 0, succeeded: 1, failed: 0 });
    await expect(getWebhookInteractionById(db, 'run-b', 'account-a')).resolves.toBeNull();
  });

  it('失敗した送信だけを1回だけ再試行へ確保し、作成失敗時は戻せる', async () => {
    const row = await createWebhookInteraction(db, {
      id: 'failed-a',
      lineAccountId: 'account-a',
      direction: 'outgoing',
      webhookId: 'webhook-a',
      webhookName: '顧客管理',
      eventType: 'friend.added',
      triggerSummary: '友だちが追加されたとき',
      requestBodyJson: '{}',
      idempotencyKey: 'delivery-a',
    });
    await finishWebhookInteraction(db, row.id, 'account-a', {
      status: 'failed', responseStatus: 500, attemptCount: 3, durationMs: 900,
      failureReason: 'response_5xx',
    });

    expect((await listFailedWebhookInteractionsForRetry(db, 'account-a')).map((item) => item.id))
      .toEqual(['failed-a']);
    await expect(claimWebhookInteractionRetry(db, row.id, 'account-a')).resolves.toBe(true);
    await expect(claimWebhookInteractionRetry(db, row.id, 'account-a')).resolves.toBe(false);
    await restoreWebhookInteractionFailure(db, row.id, 'account-a');
    expect((await getWebhookInteractionById(db, row.id, 'account-a'))?.status).toBe('failed');
  });

  it('検索と状態の条件をアカウント範囲の中だけに適用する', async () => {
    for (const [id, name, status] of [
      ['run-1', '顧客管理', 'succeeded'],
      ['run-2', '予約管理', 'failed'],
    ] as const) {
      const row = await createWebhookInteraction(db, {
        id,
        lineAccountId: 'account-a',
        direction: 'outgoing',
        webhookId: id,
        webhookName: name,
        eventType: 'booking.created',
        triggerSummary: '予約が入ったとき',
        requestBodyJson: '{}',
        idempotencyKey: id,
      });
      await finishWebhookInteraction(db, row.id, 'account-a', {
        status, responseStatus: status === 'succeeded' ? 200 : 500,
        attemptCount: 1, durationMs: 100,
        failureReason: status === 'failed' ? 'response_5xx' : null,
      });
    }

    const result = await listWebhookInteractions(db, {
      lineAccountId: 'account-a', status: 'failed', search: '予約',
    });
    expect(result.items.map((item) => item.id)).toEqual(['run-2']);
    expect(result.total).toBe(1);
  });
});
