import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getWebinarOverview } from '../src/webinars.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('V6ウェビナー一覧の集計', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-a', 'ca', 'A', 'ta', 'sa'),
             ('account-b', 'cb', 'B', 'tb', 'sb');

      INSERT INTO friends (id, line_user_id, line_account_id)
      VALUES ('friend-a1', 'Ua1', 'account-a'),
             ('friend-a2', 'Ua2', 'account-a'),
             ('friend-b1', 'Ub1', 'account-b');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('選択中アカウントの未アーカイブだけを人数と延べ予約に分ける', async () => {
    sqlite.exec(`
      INSERT INTO webinars
        (id, account_id, title, slug, status, created_at, updated_at)
      VALUES ('wa-active', 'account-a', '公開中', 'wa-active', 'active', '2026-08-01', '2026-08-01'),
             ('wa-draft', 'account-a', '下書き', 'wa-draft', 'draft', '2026-08-01', '2026-08-01'),
             ('wa-archive', 'account-a', '保管済み', 'wa-archive', 'archived', '2026-08-01', '2026-08-01'),
             ('wb-active', 'account-b', '別店舗', 'wb-active', 'active', '2026-08-01', '2026-08-01');

      INSERT INTO webinar_registrations
        (id, webinar_id, friend_id, session_start_at, status, created_at)
      VALUES ('ra1', 'wa-active', 'friend-a1', 1, 'active', '2026-08-01'),
             ('ra2', 'wa-draft', 'friend-a1', 2, 'active', '2026-08-02'),
             ('ra-cancelled', 'wa-active', 'friend-a2', 3, 'cancelled', '2026-08-03'),
             ('ra-archive', 'wa-archive', 'friend-a2', 4, 'active', '2026-08-04'),
             ('rb1', 'wb-active', 'friend-b1', 5, 'active', '2026-08-05');

      INSERT INTO webinar_viewers
        (id, webinar_id, friend_id, session_start_at, joined_at,
         last_position_seconds, cta_clicked_at)
      VALUES ('va1', 'wa-active', 'friend-a1', 1, '2026-08-01', 900, '2026-08-01'),
             ('va2', 'wa-active', 'friend-a1', 2, '2026-08-02', 1200, '2026-08-02'),
             ('va3', 'wa-draft', 'friend-a2', 3, '2026-08-03', 0, '2026-08-03'),
             ('va-archive', 'wa-archive', 'friend-a2', 4, '2026-08-04', 900, '2026-08-04'),
             ('vb1', 'wb-active', 'friend-b1', 5, '2026-08-05', 900, '2026-08-05');
    `);

    const result = await getWebinarOverview(db, 'account-a');

    expect(result).toMatchObject({ state: 'partial', registrationMode: 'people' });
    expect(result.metrics).toMatchObject({
      webinars: { value: 2, state: 'available' },
      activeWebinars: { value: 1, state: 'available' },
      registrations: { value: 1, state: 'available' },
      registrationBookings: { value: 2, state: 'available' },
      ctaUniquePeople: { value: 2, state: 'available' },
    });
  });

  it('最後の再生位置があっても有効区間が無い視聴指標を0や実値にしない', async () => {
    sqlite.exec(`
      INSERT INTO webinars
        (id, account_id, title, slug, status, created_at, updated_at)
      VALUES ('wa-active', 'account-a', '公開中', 'wa-active', 'active', '2026-08-01', '2026-08-01');
      INSERT INTO webinar_viewers
        (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
      VALUES ('va1', 'wa-active', 'friend-a1', 1, '2026-08-01', 3600);
    `);

    const result = await getWebinarOverview(db, 'account-a');

    expect(result.metrics.viewers).toEqual({
      value: null,
      state: 'unavailable',
      reason: '実際に見た区間の記録をまだ集計できないため',
    });
    expect(result.metrics.viewRate.value).toBeNull();
    expect(result.metrics.averageWatchSeconds.value).toBeNull();
    expect(result.metrics.ctaTotalClicks.value).toBeNull();
  });

  it('空の一覧は実値0にし、未接続の視聴指標だけ未取得にする', async () => {
    const result = await getWebinarOverview(db, 'account-a');

    expect(result.metrics.webinars.value).toBe(0);
    expect(result.metrics.registrations.value).toBe(0);
    expect(result.metrics.ctaUniquePeople.value).toBe(0);
    expect(result.metrics.viewers).toMatchObject({ value: null, state: 'unavailable' });
  });
});
