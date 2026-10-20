import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { getBroadcasts } from '../src/broadcasts/index.js';
import { getBroadcastStats } from '../src/dashboard.js';
import { asD1 } from './d1-test-helper.js';
test.each([51, 101, 201])('SCALE-02 %s店の配信一覧・集計も100変数以内', async size => {
 const raw=new Database(':memory:'); raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
 try {
  const db=asD1(raw); const scope={allowedAccountIds:Array.from({length:size},(_,i)=>'a'+i),canSeeUnassigned:false};
  raw.exec("INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id) VALUES('own','人工','text','人工','all','draft','a0'),('foreign','他','text','他','all','draft','foreign')");
  expect((await getBroadcasts(db,undefined,scope,{from:'2026-01-01',until:'2027-01-01'})).map(x=>x.id)).toEqual(['own']);
  await expect(getBroadcastStats(db,undefined,scope)).resolves.toMatchObject({ scheduled:0 });
 } finally{raw.close();}
});
