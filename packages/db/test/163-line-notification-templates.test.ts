import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(
  join(ROOT, 'migrations', '163_line_notification_templates.sql'),
  'utf8',
);

describe('163_line_notification_templates.sql', () => {
  it('受注・発送の旧文面をLINE通知へ引き継ぎ、トランザクション通知を一元化する', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE ec_notification_settings (
        event_type TEXT PRIMARY KEY,
        is_enabled INTEGER NOT NULL,
        title_override TEXT,
        intro_text TEXT,
        outro_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE nen_campaign_settings (
        campaign_key TEXT PRIMARY KEY,
        is_enabled INTEGER NOT NULL,
        title TEXT NOT NULL,
        body_text TEXT NOT NULL,
        button_label TEXT,
        button_url TEXT,
        image_url TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO ec_notification_settings
        (event_type, is_enabled, title_override, intro_text, outro_text, created_at, updated_at)
      VALUES
        ('ec.order.confirmed', 1, '旧注文タイトル', NULL, NULL, datetime('now'), datetime('now')),
        ('ec.order.shipped', 1, '旧発送タイトル', NULL, NULL, datetime('now'), datetime('now')),
        ('ec.subscription.upcoming', 1, '次回定期便', NULL, NULL, datetime('now'), datetime('now')),
        ('ec.subscription.payment_failed', 1, '決済失敗', NULL, NULL, datetime('now'), datetime('now')),
        ('ec.subscription.cancelled', 1, '定期便解約', NULL, NULL, datetime('now'), datetime('now'));
      INSERT INTO nen_campaign_settings
        (campaign_key, is_enabled, title, body_text, button_label, button_url, image_url, updated_at)
      VALUES
        ('order_confirmed', 1, '引継ぎ注文タイトル', '引継ぎ注文本文', '注文を見る', 'https://example.com/order', 'https://example.com/order.jpg', datetime('now')),
        ('shipping_confirmed', 1, '引継ぎ発送タイトル', '引継ぎ発送本文', '配送を見る', 'https://example.com/shipping', NULL, datetime('now'));
    `);

    db.exec(MIGRATION);

    const order = db.prepare(`SELECT * FROM ec_notification_settings WHERE event_type = 'ec.order.confirmed'`).get() as Record<string, unknown>;
    expect(order).toMatchObject({
      title_override: '引継ぎ注文タイトル',
      intro_text: '引継ぎ注文本文',
      button_label: '注文を見る',
      category: 'order',
      display_order: 10,
    });
    const added = db.prepare(`SELECT event_type, category FROM ec_notification_settings WHERE event_type IN ('ec.order.payment_received', 'ec.order.refunded', 'ec.subscription.card_updated') ORDER BY event_type`).all();
    expect(added).toEqual([
      { event_type: 'ec.order.payment_received', category: 'payment' },
      { event_type: 'ec.order.refunded', category: 'support' },
      { event_type: 'ec.subscription.card_updated', category: 'subscription' },
    ]);
    const oldCampaigns = db.prepare(`SELECT campaign_key, is_enabled FROM nen_campaign_settings ORDER BY campaign_key`).all();
    expect(oldCampaigns).toEqual([
      { campaign_key: 'order_confirmed', is_enabled: 0 },
      { campaign_key: 'shipping_confirmed', is_enabled: 0 },
    ]);
  });
});
