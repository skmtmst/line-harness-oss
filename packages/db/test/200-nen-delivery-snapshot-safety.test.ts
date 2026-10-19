import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '200_nen_delivery_snapshot_safety.sql'),
  'utf8',
);

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE nen_campaign_settings (
      campaign_key TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT NOT NULL,
      delay_days INTEGER NOT NULL, delivery_time TEXT NOT NULL, is_enabled INTEGER NOT NULL,
      title TEXT NOT NULL, body_text TEXT NOT NULL, button_label TEXT, button_url TEXT,
      image_url TEXT
    );
    CREATE TABLE nen_delivery_jobs (
      id TEXT PRIMARY KEY, campaign_key TEXT NOT NULL, status TEXT NOT NULL
    );
    INSERT INTO nen_campaign_settings VALUES
      ('column', 'NENコラム', 'column', 0, '10:00', 1,
       '予約時の見出し', '予約時の本文', '読む', 'https://example.com', NULL);
    INSERT INTO nen_delivery_jobs VALUES
      ('pending-job', 'column', 'pending'),
      ('sent-job', 'column', 'sent');
  `);
  sqlite.exec(migration);
  return sqlite;
}

describe('migration 200 NEN delivery snapshot safety', () => {
  it('fixes the current campaign copy on unsent jobs only', () => {
    const sqlite = setup();
    const pending = sqlite.prepare(
      'SELECT campaign_snapshot FROM nen_delivery_jobs WHERE id = ?',
    ).get('pending-job') as { campaign_snapshot: string };
    const sent = sqlite.prepare(
      'SELECT campaign_snapshot FROM nen_delivery_jobs WHERE id = ?',
    ).get('sent-job') as { campaign_snapshot: string | null };

    expect(JSON.parse(pending.campaign_snapshot)).toMatchObject({
      campaign_key: 'column',
      title: '予約時の見出し',
      body_text: '予約時の本文',
    });
    expect(sent.campaign_snapshot).toBeNull();

    sqlite.prepare("UPDATE nen_campaign_settings SET title = '後から編集した見出し' WHERE campaign_key = 'column'").run();
    expect(JSON.parse(pending.campaign_snapshot).title).toBe('予約時の見出し');
  });

  it('rejects broken JSON snapshots', () => {
    const sqlite = setup();
    expect(() => sqlite.prepare(
      "UPDATE nen_delivery_jobs SET campaign_snapshot = '{broken' WHERE id = 'pending-job'",
    ).run()).toThrow();
  });
});
