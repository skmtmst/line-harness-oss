import { expect, it } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import { claimMediaDeletion } from '@line-crm/db/src/media/deletion-jobs.js';
import { claimMediaForSend, purgeExpiredMediaSendClaims, releaseMediaSendClaim } from './send-claims.js';
import { mediaDeletionGuardStatements } from './deletion-guard.js';
import { senderIcon } from '../../services/line-senders.js';

it('送信中は削除を止め、終了後か期限後にのみ削除を許す', async () => {
  const f = createTestD1({ foreignKeys: false });
  try {
    f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','x','x');
      INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind,public_url)
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

it('存在しない画像と別統括の画像を同じ扱いにする', async () => {
  const f=createTestD1({foreignKeys:false});
  try {
    f.raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES('a','t1','a','A','x','x'),('b','t2','b','B','x','x');
      INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key) VALUES('other','b','image','b','image/png',1,'other');
      INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,created_at,updated_at) VALUES('other','b','["other"]','checking','now','now');`);
    for (const id of ['missing','other']) await expect(f.db.batch(mediaDeletionGuardStatements(f.db,[id],['a']))).rejects.toThrow('media_cross_tenant_reference');
    for (const id of ['missing','other']) await expect(senderIcon(f.db,'a',id)).rejects.toMatchObject({code:'使えない画像です',status:404});
  } finally {f.raw.close();}
});

it('別の統括の画像では送信中の参照を確保しない', async () => {
  const f = createTestD1({ foreignKeys: false });
  try {
    f.raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id)
        VALUES('a','a','A','x','x','t1'),('b','b','B','x','x','t2');
      INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind)
        VALUES('m','a','objects/key','image.png','image/png',1,'image');`);
    await expect(claimMediaForSend(f.db,{claimId:'send',accountId:'b',content:'https://cdn.test/objects/key',expiresAt:'2026-01-01T00:05:00Z'}))
      .rejects.toThrow('media_cross_tenant_reference');
    expect(f.raw.prepare('SELECT count(*) n FROM media_send_claims').get()).toEqual({ n: 0 });
  } finally { f.raw.close(); }
});

it('店未指定のトークも送信者の統括で画像を確かめる', async () => {
  const f=createTestD1({foreignKeys:false});
  try {
    f.raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES('a','t1','a','A','x','x'),('b','t2','b','B','x','x');
      INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key) VALUES('own','a','image','a','image/png',1,'images/own.png'),('other','b','image','b','image/png',1,'images/other.png');`);
    await claimMediaForSend(f.db,{claimId:'one',accountId:'',tenantId:'t1',content:'https://cdn.test/images/own.png',expiresAt:'2027-01-01'});
    await expect(claimMediaForSend(f.db,{claimId:'two',accountId:'',tenantId:'t1',content:'https://cdn.test/images/other.png',expiresAt:'2027-01-01'})).rejects.toThrow('media_cross_tenant_reference');
    expect(f.raw.prepare('SELECT media_id FROM media_send_claims').all()).toEqual([{media_id:'own'}]);
  } finally {f.raw.close();}
});
