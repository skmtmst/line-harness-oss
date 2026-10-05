import Database from 'better-sqlite3';
import { expect,it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { connectVerifiedAdPlatform,type AdPlatform } from '../src/ad-platforms.js';
it('疎通確認の設定が同じときだけ接続し、古い確認を受け付けない',async()=>{
 const raw=new Database(':memory:');
 try {
  raw.exec("CREATE TABLE ad_platforms(id TEXT,line_account_id TEXT,name TEXT,updated_at TEXT,config TEXT,config_encrypted TEXT,verified_at TEXT,is_active INTEGER); INSERT INTO ad_platforms VALUES('p','a','meta','old','{}',NULL,NULL,0)");
  const platform=raw.prepare('SELECT * FROM ad_platforms').get() as AdPlatform;
  raw.exec("UPDATE ad_platforms SET config='{} '");
  expect(await connectVerifiedAdPlatform(asD1(raw),platform)).toBe(false);
  raw.exec("UPDATE ad_platforms SET config='{}'");
  expect(await connectVerifiedAdPlatform(asD1(raw),platform,'now')).toBe(true);
  expect(raw.prepare('SELECT verified_at,is_active FROM ad_platforms').get()).toEqual({verified_at:'now',is_active:1});
 } finally{raw.close();}
});
