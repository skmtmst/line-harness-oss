import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('予約経路への移行', () => {
  it('既存の媒体・予約の参照を保ち、見本のない媒体を準備中として追加する', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      for (const file of ['168_restaurant_test_foundation.sql', '170_restaurant_inbound_emails.sql', '171_restaurant_email_parsers.sql']) {
        db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
      }
      db.exec(`INSERT INTO rt_organizations (id, account_id, name) VALUES ('org', 'account', '確認');
        INSERT INTO rt_stores (id, organization_id, name, code) VALUES ('store', 'org', '確認', 'S');
        INSERT INTO rt_inbound_emails (id, message_id, store_id, status) VALUES ('email', 'message', 'store', 'received');
        INSERT INTO rt_email_digests (id, store_id, media_id, target_date, reported_count, inbound_email_id) VALUES ('digest', 'store', 'media-hotpepper', '2026-10-10', 2, 'email');
        INSERT INTO rt_sync_events (id, store_id, provider, external_event_id, payload_json, status, error_message)
          VALUES ('event', 'store', 'email', 'message', '{"media":"hotpepper"}', 'failed', 'unprocessed:kind_unknown');
        INSERT INTO rt_reservations (id, store_id, source, external_id, customer_name, guest_count, starts_at, ends_at, media_id)
          VALUES ('reservation', 'store', 'hotpepper', 'external', '確認', 2, '2026-10-10T10:00:00Z', '2026-10-10T12:00:00Z', 'media-hotpepper');`);
      db.transaction(() => db.exec(readFileSync(new URL('../migrations/545_restaurant_channels.sql', import.meta.url), 'utf8')))();
      expect(db.prepare('SELECT media_id FROM rt_reservations').get()).toEqual({ media_id: 'media-hotpepper' });
      expect(db.prepare('SELECT media_id, status, quarantine_reason FROM rt_inbound_emails').get()).toEqual({ media_id: 'media-hotpepper', status: 'quarantined', quarantine_reason: 'unprocessed:kind_unknown' });
      expect(db.prepare('SELECT code FROM rt_media WHERE is_active = 0 ORDER BY code').all()).toEqual([
        { code: 'google_reservation' }, { code: 'ikyu' }, { code: 'tablecheck' },
      ]);
      expect(db.prepare('SELECT id, media_id, reported_count FROM rt_email_digests').get()).toEqual({ id: 'digest', media_id: 'media-hotpepper', reported_count: 2 });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
