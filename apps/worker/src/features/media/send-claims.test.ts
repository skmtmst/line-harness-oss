import { expect, it } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import { claimMediaDeletion } from '@line-crm/db/src/media/deletion-jobs.js';
import { claimMediaForSend, purgeExpiredMediaSendClaims, releaseMediaSendClaim } from './send-claims.js';

it('送信中は削除を止め、終了後か期限後にのみ削除を許す', async () => {
  const f = createTestD1({ foreignKeys: false });
  try {
    f.raw.exec(`INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind,public_url)
      VALUES('m','a','objects/key','image.png','image/png',1,'image','https://cdn.test/objects/key')`);
    await claimMediaForSend(f.db,{claimId:'send',accountId:'a',content:'https://cdn.test/objects/key',expiresAt:'2026-01-01T00:05:00Z'});
    const claim = () => claimMediaDeletion(f.db,{mediaId:'m',accountId:'a',owner:'delete',now:'2026-01-01T00:00:00Z',leaseUntil:'2026-01-01T00:01:00Z'});
    expect(await claim()).toBeNull();
    await releaseMediaSendClaim(f.db,'send');
    expect(await claim()).not.toBeNull();
    await expect(claimMediaForSend(f.db,{claimId:'send2',accountId:'a',content:'https://cdn.test/objects/key',expiresAt:'2026-01-01T00:05:00Z'})).rejects.toThrow('media_deletion_in_progress');
    f.raw.exec('DELETE FROM media_deletion_jobs');
    await claimMediaForSend(f.db,{claimId:'stale',accountId:'a',content:'https://cdn.test/objects/key',expiresAt:'2026-01-01T00:05:00Z'});
    await purgeExpiredMediaSendClaims(f.db,'2026-01-01T00:04:59Z');
    expect(f.raw.prepare('SELECT count(*) n FROM media_send_claims').get()).toEqual({ n: 1 });
    await purgeExpiredMediaSendClaims(f.db,'2026-01-01T00:05:00Z');
    expect(f.raw.prepare('SELECT count(*) n FROM media_send_claims').get()).toEqual({ n: 0 });
  } finally { f.raw.close(); }
});
