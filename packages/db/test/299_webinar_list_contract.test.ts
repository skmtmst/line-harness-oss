import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getWebinarFolderCounts, getWebinarList } from '../src/webinars.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('299 ウェビナー一覧契約', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-a','ca','A','ta','sa'), ('account-b','cb','B','tb','sb');
      INSERT INTO friends (id, line_user_id, line_account_id, is_following, is_hidden)
      VALUES ('friend-a1','Ua1','account-a',1,0),
             ('friend-a2','Ua2','account-a',1,0),
             ('friend-b1','Ub1','account-b',1,0);
      INSERT INTO folders (id, kind, name, display_order)
      VALUES ('folder-sales','webinar','販売',0), ('folder-other','webinar','その他',1);
      INSERT INTO webinars
        (id, account_id, title, slug, status, duration_seconds, schedule_json, folder_id,
         publication_starts_at, publication_ends_at, created_at, updated_at)
      VALUES
        ('wa1','account-a','A公開中','wa1','active',3600,'[]','folder-sales',
         '2026-09-01T00:00:00.000Z','2026-09-30T00:00:00.000Z','2026-09-02','2026-09-02'),
        ('wa2','account-a','A下書き','wa2','draft',3600,'[]','folder-sales',
         NULL,NULL,'2026-09-01','2026-09-01'),
        ('wax','account-a','A保管済み','wax','archived',3600,'[]','folder-other',
         NULL,NULL,'2026-09-03','2026-09-03'),
        ('wb1','account-b','B公開中','wb1','active',3600,'[]','folder-other',
         NULL,NULL,'2026-09-04','2026-09-04');
      INSERT INTO webinar_registrations
        (id, webinar_id, friend_id, session_start_at, status, created_at)
      VALUES ('r1','wa1','friend-a1',1,'active','2026-09-01'),
             ('r2','wa1','friend-a1',2,'active','2026-09-01'),
             ('r3','wa1','friend-a2',2,'cancelled','2026-09-01'),
             ('rb','wb1','friend-b1',1,'active','2026-09-01');
      INSERT INTO webinar_viewers
        (id, webinar_id, friend_id, session_start_at, joined_at)
      VALUES ('v1','wa1','friend-a1',1,'2026-09-01'),
             ('v2','wa1','friend-a1',2,'2026-09-01'),
             ('v3','wa1','friend-a2',2,'2026-09-01'),
             ('vb','wb1','friend-b1',1,'2026-09-01');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('権限内の非保管ウェビナーへフォルダ名・申込人数・視聴人数・公開期間を付ける', async () => {
    const rows = await getWebinarList(db, {
      allowedAccountIds: ['account-a'],
      canSeeUnassigned: false,
    });

    expect(rows.map((row) => row.id)).toEqual(['wa1', 'wa2']);
    expect(rows[0]).toMatchObject({
      folder_id: 'folder-sales',
      folder_name: '販売',
      registration_count: 1,
      viewer_count: 2,
      publication_starts_at: '2026-09-01T00:00:00.000Z',
      publication_ends_at: '2026-09-30T00:00:00.000Z',
    });
  });

  it('許可外アカウントの指定をDB境界でも空にし、フォルダ件数も権限内だけにする', async () => {
    const rows = await getWebinarList(db, {
      allowedAccountIds: ['account-a'],
      canSeeUnassigned: false,
      accountId: 'account-b',
    });
    const counts = await getWebinarFolderCounts(db, {
      allowedAccountIds: ['account-a'],
      canSeeUnassigned: false,
    });

    expect(rows).toEqual([]);
    expect(counts).toEqual({ 'folder-sales': 2 });
  });
});
