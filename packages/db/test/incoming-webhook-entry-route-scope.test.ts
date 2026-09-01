import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getIncomingWebhooks } from '../src/webhooks.js';
import { getEntryRouteByRefCode, getEntryRoutes } from '../src/entry-routes.js';
import { asD1 } from './d1-test-helper.js';

describe('受信Webhookと流入経路の統括分離', () => {
  let db: D1Database;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY, tenant_id TEXT);
      CREATE TABLE incoming_webhooks (
        id TEXT PRIMARY KEY, name TEXT, source_type TEXT, secret TEXT, is_active INTEGER,
        line_account_id TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE entry_routes (
        id TEXT PRIMARY KEY, ref_code TEXT, name TEXT, is_active INTEGER,
        tenant_id TEXT, created_at TEXT, updated_at TEXT
      );
      INSERT INTO line_accounts VALUES
        ('account-default', '${DEFAULT_TENANT_ID}'), ('account-b', 'tenant-b');
      INSERT INTO incoming_webhooks VALUES
        ('wh-default', 'default', 'custom', NULL, 1, 'account-default', '1', '1'),
        ('wh-b', 'B', 'custom', NULL, 1, 'account-b', '2', '2'),
        ('wh-legacy', 'legacy', 'custom', NULL, 1, NULL, '3', '3');
      INSERT INTO entry_routes VALUES
        ('route-default', 'default-ref', 'default', 1, '${DEFAULT_TENANT_ID}', '1', '1'),
        ('route-b', 'b-ref', 'B', 1, 'tenant-b', '2', '2'),
        ('route-legacy', 'legacy-ref', 'legacy', 1, NULL, '3', '3');
    `);
    db = asD1(sqlite);
  });

  it('受信WebhookはLINEアカウント単位で分離し、所属不明の旧行を管理一覧へ出さない', async () => {
    expect((await getIncomingWebhooks(db, 'account-default')).map((row) => row.id))
      .toEqual(['wh-default']);
    expect((await getIncomingWebhooks(db, 'account-b')).map((row) => row.id)).toEqual(['wh-b']);
    expect((await getIncomingWebhooks(db, 'missing-account')).map((row) => row.id)).toEqual([]);

    // 流入経路は従来どおり統括単位であり、この変更の対象外。
    expect((await getEntryRoutes(db, DEFAULT_TENANT_ID)).map((row) => row.id).sort())
      .toEqual(['route-default', 'route-legacy']);
    expect((await getEntryRoutes(db, 'tenant-b')).map((row) => row.id)).toEqual(['route-b']);
  });

  it('公開refコード取得は統括引数を持たず、どの持ち主の経路も従来どおり取得する', async () => {
    await expect(getEntryRouteByRefCode(db, 'b-ref')).resolves.toEqual(expect.objectContaining({ id: 'route-b' }));
    await expect(getEntryRouteByRefCode(db, 'legacy-ref')).resolves.toEqual(expect.objectContaining({ id: 'route-legacy' }));
  });
});
