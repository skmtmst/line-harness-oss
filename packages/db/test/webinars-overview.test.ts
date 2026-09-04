import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getWebinarOverview } from '../src/webinars.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('ウェビナー概要', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-a','ca','A','ta','sa'), ('account-b','cb','B','tb','sb')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id, is_following, is_hidden)
       VALUES ('friend-a1','Ua1','account-a',1,0),
              ('friend-a2','Ua2','account-a',1,0),
              ('friend-b1','Ub1','account-b',1,0)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO webinars
         (id, account_id, title, slug, status, duration_seconds, schedule_json, created_at, updated_at)
       VALUES ('wa1','account-a','公開中','wa1','active',3600,'[]','2026-09-01','2026-09-01'),
              ('wa2','account-a','下書き','wa2','draft',3600,'[]','2026-09-01','2026-09-01'),
              ('wax','account-a','保管済み','wax','archived',3600,'[]','2026-09-01','2026-09-01'),
              ('wb1','account-b','別アカウント','wb1','active',3600,'[]','2026-09-01','2026-09-01')`,
    ).run();
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('非アーカイブだけを対象に人数と予約枠数を分けて集計する', async () => {
    const insertRegistration = sqlite.prepare(
      `INSERT INTO webinar_registrations
         (id, webinar_id, friend_id, session_start_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, '2026-09-01')`,
    );
    insertRegistration.run('r1', 'wa1', 'friend-a1', 1, 'active');
    insertRegistration.run('r2', 'wa1', 'friend-a1', 2, 'active');
    insertRegistration.run('r3', 'wa2', 'friend-a2', 1, 'active');
    insertRegistration.run('r4', 'wa2', 'friend-a2', 2, 'cancelled');
    insertRegistration.run('rx', 'wax', 'friend-a2', 3, 'active');
    insertRegistration.run('rb', 'wb1', 'friend-b1', 1, 'active');

    const insertViewer = sqlite.prepare(
      `INSERT INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, cta_clicked_at)
       VALUES (?, ?, ?, ?, '2026-09-01', ?)`,
    );
    insertViewer.run('v1', 'wa1', 'friend-a1', 1, '2026-09-01');
    insertViewer.run('v2', 'wa2', 'friend-a1', 2, '2026-09-01');
    insertViewer.run('v3', 'wa2', 'friend-a2', 1, null);
    insertViewer.run('vx', 'wax', 'friend-a2', 3, '2026-09-01');
    insertViewer.run('vb', 'wb1', 'friend-b1', 1, '2026-09-01');

    const result = await getWebinarOverview(db, 'account-a');

    expect(result).toMatchObject({
      state: 'partial',
      registrationMode: 'people',
      metrics: {
        webinars: { value: 2, state: 'available' },
        activeWebinars: { value: 1, state: 'available' },
        registrations: { value: 2, state: 'available' },
        registrationBookings: { value: 3, state: 'available' },
        viewers: { value: null, state: 'unavailable' },
        ctaUniquePeople: { value: 1, state: 'available' },
        ctaTotalClicks: { value: null, state: 'unavailable' },
      },
    });
  });

  it('対象データがない実測値は利用不可ではなく0件にする', async () => {
    const result = await getWebinarOverview(db, 'missing-account');

    expect(result.metrics.webinars.value).toBe(0);
    expect(result.metrics.registrations.value).toBe(0);
    expect(result.metrics.ctaUniquePeople.value).toBe(0);
    expect(result.metrics.viewers).toMatchObject({ value: null, state: 'unavailable' });
  });
});
