import { expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { saveNenCampaignAccountSetting, type CampaignRow } from './nen-engagement.js';
import { findDirectMediaUsages } from '../features/media/direct-media-usages.js';
import { captureMediaPurgeImpacts } from './tenant-media-impact.js';

test('NEN 配信設定は同じ統括の画像だけを保存し削除中は拒む', async () => {
  const {db,raw}=createTestD1({foreignKeys:false});
  try {
    raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','A','x','x','t1'),('b','b','B','x','x','t2');
      INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind) VALUES('own','a','images/own.png','own.png','image/png',1,'image'),('other','b','images/other.png','other.png','image/png',1,'image');`);
    const save=(image_url:string) => saveNenCampaignAccountSetting(db,'a',{campaign_key:'test',image_url} as CampaignRow,'t1');
    await expect(save('https://example.invalid/images/own.png')).resolves.toBeUndefined();
    expect(await findDirectMediaUsages(db,{id:'own',r2_key:'images/own.png'},'a')).toEqual(expect.arrayContaining([
      expect.objectContaining({name:'キャンペーン通知（店舗）（1件）'}),
    ]));
    await captureMediaPurgeImpacts(db,'t2',[{key:'images/own.png',mediaId:'own',ownerAccount:'b',includeLive:true}],'2026-11-05');
    expect(raw.prepare("SELECT target_tenant_id,target_line_account_id,usage_count FROM media_purge_impact_pending WHERE target_kind='nen_campaign'").get())
      .toEqual({target_tenant_id:'t1',target_line_account_id:'a',usage_count:1});
    await expect(save('https://example.invalid/images/other.png')).rejects.toThrow('media_cross_tenant_reference');
    raw.exec("INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,created_at,updated_at) VALUES('own','a','[\"images/own.png\"]','checking','now','now')");
    await expect(save('https://example.invalid/images/own.png')).rejects.toThrow('media_deletion_in_progress');
    expect(raw.prepare("SELECT COUNT(*) n FROM account_settings WHERE key='nen.campaign.test'").get()).toEqual({n:1});
  } finally {raw.close();}
});
