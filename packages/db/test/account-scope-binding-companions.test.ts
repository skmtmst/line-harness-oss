import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { getCalendarConnections } from '../src/calendar.js';
import { getTagGroups } from '../src/tags/index.js';
import { getAffiliates } from '../src/affiliates.js';
import { getConversionPoints } from '../src/conversions/index.js';
import { asD1 } from './d1-test-helper.js';
test('SCALE-02 仲間の201店舗の所属範囲も100変数を超えない', async()=>{
 const raw=new Database(':memory:');raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
 try {
 const db=asD1(raw), ids=Array.from({length:201},(_,i)=>'synthetic-'+i);
 const calls=[
  ()=>getCalendarConnections(db,{allowedAccountIds:ids,includeUnassigned:false}),
  ()=>getTagGroups(db,{allowedAccountIds:ids,canSeeUnassigned:false}),
  ()=>getAffiliates(db,{tenantId:'synthetic',allowedLineAccountIds:ids}),
  ()=>getConversionPoints(db,{allowedLineAccountIds:ids,includeUnassigned:false}),
 ];
 for(const call of calls) await expect(call()).resolves.toEqual([]);
 }finally{raw.close();}
});
