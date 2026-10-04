// F-21 対応表の読み書き・F-22 送信のやり直し。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  AdEventMappingError,
  listAdEventMappings,
  resendAdConversion,
  saveAdEventMappings,
} from './ad-event-mappings.js';
import { sendAdConversions } from './ad-conversion.js';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('F-21 対応表の読み書き', () => {
  it('地点と媒体の名前付きで読み、まるごと保存できる', async () => {
    const saved = await saveAdEventMappings(db.db, 'account-1', [
      { conversionPointId: 'point-1', adPlatformId: 'platform-1', eventName: 'Purchase' },
    ]);
    expect(saved.mappings).toHaveLength(1);
    expect(saved.mappings[0]?.conversionPointName).toBe('購入');
    expect(saved.mappings[0]?.eventName).toBe('Purchase');
    expect(saved.points).toEqual([{ id: 'point-1', name: '購入' }]);
    expect(saved.platforms).toHaveLength(1);
    const listed = await listAdEventMappings(db.db, 'account-1');
    expect(listed.mappings).toHaveLength(1);
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
  it('失敗した元の送信を同じ目印・金額・通貨でやり直し、成功後は送らない', async () => {
    raw.prepare(`UPDATE ad_platforms SET is_active = 1,
      config = '{"pixel_id":"pixel-1","access_token":"token-1","click_id_validity_days":3650}'
      WHERE id = 'platform-1'`).run();
    raw.prepare(`INSERT INTO ref_tracking
      (id, ref_code, friend_id, fbclid, line_account_id, ad_conversion_consent_at, created_at)
      VALUES ('ref-1', 'ref-1', 'friend-1', 'click-1', 'account-1', ?, ?)`).run(
        new Date().toISOString(), new Date().toISOString(),
      );
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: bodies.length > 1, status: bodies.length > 1 ? 200 : 500, text: async () => 'result' };
    }));
    await sendAdConversions(db.db, 'friend-1', 'Purchase', 1000, {
      idempotencyKey: 'purchase-1', lineAccountId: 'account-1', currency: 'USD', amountInMinorUnit: true,
    });
    const log = raw.prepare('SELECT id FROM ad_conversion_logs').get() as { id: string };
    expect(await resendAdConversion(db.db, log.id, 'account-1')).toEqual({ logId: log.id, resent: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ data: [{
      event_id: 'purchase-1:platform-1', event_name: 'Purchase',
      custom_data: { value: 10, currency: 'USD' },
    }] });
    expect(raw.prepare('SELECT id, status, idempotency_key FROM ad_conversion_logs').all()).toEqual([
      { id: log.id, status: 'sent', idempotency_key: 'purchase-1' },
    ]);
    expect(await resendAdConversion(db.db, log.id, 'account-1')).toEqual({ logId: log.id, resent: false });
    expect(bodies).toHaveLength(2);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM ad_conversion_outbox').get()).toEqual({ count: 1 });
  });

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
