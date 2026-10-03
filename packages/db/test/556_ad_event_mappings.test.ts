import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  getAdEventMapping,
  retryAdConversionOutbox,
  upsertAdEventMapping,
} from '../src/ad-platforms.js';
import { asD1 } from './d1-test-helper.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const NOW_MS = Date.parse('2026-10-03T12:00:00+09:00');

function jstDaysAgo(days: number): string {
  const ms = NOW_MS - days * 86_400_000;
  const jst = new Date(ms + 9 * 60 * 60_000);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('account-1', 'channel-1', '本店', 'token', 'secret', '${TENANT_ID}');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-1', 'U1', 'はなこ', 'account-1');
    INSERT INTO conversion_points (id, name, event_type, value, line_account_id)
    VALUES ('point-1', '購入', 'purchase', 10000, 'account-1');
    INSERT INTO ad_platforms (id, name, line_account_id, config)
    VALUES ('p1', 'meta', 'account-1', '{}');
    INSERT INTO ad_conversion_outbox (id, ad_platform_id, friend_id, event_name, idempotency_key, status, created_at, updated_at)
    VALUES ('failed-recent', 'p1', 'friend-1', 'Purchase', 'key-1', 'failed', '${jstDaysAgo(5)}', '${jstDaysAgo(5)}'),
           ('failed-old', 'p1', 'friend-1', 'Purchase', 'key-2', 'failed', '${jstDaysAgo(91)}', '${jstDaysAgo(91)}'),
           ('sent-row', 'p1', 'friend-1', 'Purchase', 'key-3', 'sent', '${jstDaysAgo(5)}', '${jstDaysAgo(5)}');
  `);
  db = asD1(sqlite);
});

describe('556 F-21 対応表', () => {
  test('無い地点はnull、保存したら読める', async () => {
    expect(await getAdEventMapping(db, 'point-1')).toBeNull();
    const saved = await upsertAdEventMapping(db, 'point-1', 'Purchase');
    expect(saved.event_name).toBe('Purchase');
    const read = await getAdEventMapping(db, 'point-1');
    expect(read?.event_name).toBe('Purchase');
  });

  test('上書きできる', async () => {
    await upsertAdEventMapping(db, 'point-1', 'Purchase');
    await upsertAdEventMapping(db, 'point-1', 'Lead');
    expect((await getAdEventMapping(db, 'point-1'))?.event_name).toBe('Lead');
  });

  test('空と長すぎは投げる', async () => {
    await expect(upsertAdEventMapping(db, 'point-1', '  ')).rejects.toThrow('ad_event_mapping_name_invalid');
    await expect(upsertAdEventMapping(db, 'point-1', 'x'.repeat(101))).rejects.toThrow('ad_event_mapping_name_invalid');
  });
});

describe('556 F-22 やり直し', () => {
  const now = new Date(NOW_MS);

  test('失敗行を送り直しの列に戻し、冪等キーは変えない', async () => {
    expect(await retryAdConversionOutbox(db, 'failed-recent', now)).toEqual({ ok: true });
    const row = sqlite.prepare('SELECT status, idempotency_key FROM ad_conversion_outbox WHERE id = ?').get('failed-recent') as { status: string; idempotency_key: string };
    expect(row.status).toBe('pending');
    expect(row.idempotency_key).toBe('key-1');
  });

  test('失敗でない行は拒む', async () => {
    expect(await retryAdConversionOutbox(db, 'sent-row', now)).toEqual({ ok: false, reason: 'not_failed' });
  });

  test('91日前の行は拒む', async () => {
    expect(await retryAdConversionOutbox(db, 'failed-old', now)).toEqual({ ok: false, reason: 'expired' });
  });

  test('無い行はnot_found', async () => {
    expect(await retryAdConversionOutbox(db, 'no-such', now)).toEqual({ ok: false, reason: 'not_found' });
  });
});
