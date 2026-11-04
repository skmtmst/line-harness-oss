import { expect, test } from 'vitest';
import { purgeExpiredMediaDeletionChecks } from '@line-crm/db/src/media/deletion-jobs.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { releasePurgeMediaLeases } from './tenant-purge-media-lock.js';

test('削除開始に失敗した確認中の印は期限で掃除し、削除中の記録は残す', async () => {
  const { db, raw } = createTestD1({ foreignKeys: false });
  try {
    const insert = raw.prepare(`INSERT INTO media_deletion_jobs
      (media_id,line_account_id,r2_keys_json,status,lease_owner,lease_expires_at,created_at,updated_at)
      VALUES (?, 'account', '[]', ?, 'owner', '2026-01-02', '2026-01-01', '2026-01-01')`);
    insert.run('checking', 'checking');
    insert.run('deleting', 'deleting');
    await releasePurgeMediaLeases(db, { mediaIds: ['checking', 'deleting'], owner: 'owner', now: '2026-01-01' });
    await purgeExpiredMediaDeletionChecks(db, '2026-01-01');
    expect(raw.prepare('SELECT media_id FROM media_deletion_jobs ORDER BY media_id').all()).toEqual([{ media_id: 'deleting' }]);
  } finally { raw.close(); }
});
