import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  duplicateNenColumn,
  previewNenColumnAudience,
  recordNenColumnReadEvent,
  sendPendingNenDeliveriesNow,
} from './nen-column-operations.js';

describe('NEN column operations', () => {
  let testDb: SqliteD1;
  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, created_at, updated_at)
      VALUES ('account-a', 'channel-a', '本店', 'token', 'secret', '2026-01-01', '2026-01-01')`).run();
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a', display_name: 'A', line_user_id: 'Ua' });
    insertFriend(testDb.raw, 'friend-b', { line_account_id: 'account-a', display_name: 'B', line_user_id: 'Ub' });
    testDb.raw.prepare(`INSERT INTO tags (id, name, line_account_id, created_at, updated_at)
      VALUES ('tag-target', '対象', 'account-a', '2026-01-01', '2026-01-01'),
             ('tag-read', '読了', 'account-a', '2026-01-01', '2026-01-01')`).run();
    testDb.raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend-a', 'tag-target')`).run();
    testDb.raw.prepare(`INSERT INTO nen_columns
      (id, slug, title, excerpt, intro_text, article_url, delivery_status, line_account_id,
       target_mode, target_tag_id, completion_event_name, completion_tag_id, created_at, updated_at)
      VALUES ('column-a', 'column-a', '健康', '概要', '紹介', 'https://example.com/a', 'draft',
              'account-a', 'tag', 'tag-target', '健康コラム読了', 'tag-read', '2026-01-01', '2026-01-01')`).run();
  });

  it('previews the exact tagged audience and duplicates saved settings', async () => {
    await expect(previewNenColumnAudience(testDb.db, {
      lineAccountId: 'account-a', targetMode: 'tag', targetTagId: 'tag-target',
    })).resolves.toMatchObject({ count: 1 });
    const copied = await duplicateNenColumn(testDb.db, { id: 'column-a', lineAccountId: 'account-a' });
    expect(testDb.raw.prepare(`SELECT source_column_id, target_tag_id, completion_tag_id FROM nen_columns WHERE id = ?`)
      .get(copied.id)).toEqual({ source_column_id: 'column-a', target_tag_id: 'tag-target', completion_tag_id: 'tag-read' });
  });

  it('records completion once and assigns the configured tag', async () => {
    const input = { lineAccountId: 'account-a', columnId: 'column-a', friendId: 'friend-a', eventKind: 'completed' as const, idempotencyKey: 'read-1' };
    await expect(recordNenColumnReadEvent(testDb.db, input)).resolves.toEqual({ recorded: true, tagged: true });
    await expect(recordNenColumnReadEvent(testDb.db, input)).resolves.toEqual({ recorded: false, tagged: true });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM friend_tags WHERE friend_id = 'friend-a' AND tag_id = 'tag-read'`).get()).toEqual({ count: 1 });
  });

  it('moves only the confirmed number of future pending jobs to now', async () => {
    testDb.raw.prepare(`INSERT INTO nen_campaign_settings
      (campaign_key, label, category, delay_days, delivery_time, is_enabled, title, body_text, created_at, updated_at)
      VALUES ('column', 'コラム', 'column', 0, '10:00', 1, '題名', '本文', '2026-01-01', '2026-01-01')`).run();
    testDb.raw.prepare(`INSERT INTO nen_delivery_jobs
      (id, campaign_key, friend_id, line_account_id, source_key, payload, scheduled_at, status, attempts, created_at, updated_at)
      VALUES ('job-a', 'column', 'friend-a', 'account-a', 'column:column-a', '{}', '2099-01-01', 'pending', 0, '2026-01-01', '2026-01-01')`).run();
    await expect(sendPendingNenDeliveriesNow(testDb.db, { lineAccountId: 'account-a', expectedCount: 0 }))
      .rejects.toMatchObject({ code: 'pending_count_changed', status: 409 });
    await expect(sendPendingNenDeliveriesNow(testDb.db, { lineAccountId: 'account-a', expectedCount: 1 }))
      .resolves.toEqual({ queued: 1 });
  });
});
