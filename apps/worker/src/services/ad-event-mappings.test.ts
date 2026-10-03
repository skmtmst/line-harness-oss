// F-21 対応表の読み書き・F-22 送信のやり直し。
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  AdEventMappingError,
  listAdEventMappings,
  resendAdConversion,
  saveAdEventMappings,
} from './ad-event-mappings.js';

let db: SqliteD1;
let raw: Database.Database;

function seedBase(): void {
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '店舗1')`).run();
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO conversion_points (id, name, event_type, line_account_id, status)
     VALUES ('point-1', '購入', 'purchase', 'account-1', 'active')`,
  ).run();
  raw.prepare(
    `INSERT INTO ad_platforms (id, name, config, is_active, line_account_id, created_at, updated_at)
     VALUES ('platform-1', 'meta', '{}', 1, 'account-1', datetime('now'), datetime('now'))`,
  ).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, metadata, created_at, updated_at)
     VALUES ('friend-1', 'U-friend-1', '友だち1', 'account-1', '{}', datetime('now'), datetime('now'))`,
  ).run();
}

beforeEach(() => {
  const created = createTestD1();
  db = created;
  raw = created.raw;
  seedBase();
});

describe('F-21 対応表の読み書き', () => {
  it('地点と媒体の名前付きで読み、まるごと保存できる', async () => {
    const saved = await saveAdEventMappings(db.db, 'account-1', [
      { conversionPointId: 'point-1', adPlatformId: 'platform-1', eventName: 'Purchase' },
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.conversionPointName).toBe('購入');
    expect(saved[0]?.eventName).toBe('Purchase');
    const listed = await listAdEventMappings(db.db, 'account-1');
    expect(listed).toHaveLength(1);
  });

  it('空の名前・長い名前・重複は受け付けない', async () => {
    await expect(saveAdEventMappings(db.db, 'account-1', [
      { conversionPointId: 'point-1', adPlatformId: 'platform-1', eventName: '  ' },
    ])).rejects.toMatchObject({ code: 'invalid_mapping' });
    await expect(saveAdEventMappings(db.db, 'account-1', [
      { conversionPointId: 'point-1', adPlatformId: 'platform-1', eventName: 'Purchase' },
      { conversionPointId: 'point-1', adPlatformId: 'platform-1', eventName: 'Lead' },
    ])).rejects.toMatchObject({ code: 'invalid_mapping' });
  });

  it('別の店の地点・媒体は受け付けない', async () => {
    await expect(saveAdEventMappings(db.db, 'account-1', [
      { conversionPointId: 'no-such-point', adPlatformId: 'platform-1', eventName: 'Purchase' },
    ])).rejects.toMatchObject({ code: 'mapping_not_found' });
    await expect(saveAdEventMappings(db.db, 'account-1', [
      { conversionPointId: 'point-1', adPlatformId: 'no-such-platform', eventName: 'Purchase' },
    ])).rejects.toMatchObject({ code: 'mapping_not_found' });
  });
});

describe('F-22 送信のやり直し', () => {
  function insertLog(createdAt: string): string {
    raw.prepare(
      `INSERT INTO ad_conversion_logs
         (id, ad_platform_id, friend_id, conversion_point_id, event_name, status, request_body, created_at)
       VALUES ('log-1', 'platform-1', 'friend-1', 'point-1', 'Purchase', 'failed', '{"value":1000}', ?)`,
    ).run(createdAt);
    return 'log-1';
  }

  it('同じ目印で送り直せる', async () => {
    const id = insertLog(new Date().toISOString());
    const result = await resendAdConversion(db.db, id, 'account-1');
    expect(result).toEqual({ logId: id, resent: true });
    const outbox = raw.prepare(`SELECT idempotency_key FROM ad_conversion_outbox`).all() as Array<{ idempotency_key: string }>;
    expect(outbox.some((row) => row.idempotency_key === id)).toBe(true);
  });

  it('90日を過ぎた記録は受け付けない', async () => {
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    const id = insertLog(old);
    await expect(resendAdConversion(db.db, id, 'account-1')).rejects.toMatchObject({ code: 'resend_expired' });
  });

  it('別の店の履歴は触れない', async () => {
    const id = insertLog(new Date().toISOString());
    await expect(resendAdConversion(db.db, id, 'account-2')).rejects.toMatchObject({ code: 'log_not_found' });
  });
});
