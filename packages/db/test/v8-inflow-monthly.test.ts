import Database from 'better-sqlite3';import { readFileSync } from 'node:fs';import { expect,it } from 'vitest';
import { asD1 } from './d1-test-helper.js';import { createEntryRoute,getEntryRouteFunnel } from '../src/entry-routes.js';
it('aggregates first-touch cohorts including months, blocks and captured revenue',async()=>{
 const raw=new Database(':memory:');raw.exec(readFileSync('bootstrap.sql','utf8'));const db=asD1(raw);
 raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','a','A','token','secret');
 INSERT INTO friends(id,line_user_id,line_account_id,ref_code,is_following,created_at) VALUES
 ('f1','U1','a','summer',1,'2026-09-30T16:00:00Z'),('f2','U2','a','summer',0,'2026-09-12 12:00:00'),('f3','U3','a','other',1,'2026-10-01');
 INSERT INTO conversion_points(id,name,event_type,value,line_account_id) VALUES ('p','Purchase','purchase',9999,'a');
 INSERT INTO conversion_events(id,conversion_point_id,friend_id,value_snapshot,created_at) VALUES
 ('v','p','f1',2400,'2026-10-01'),('other','p','f3',9999,'2026-10-01');`);
 const route=await createEntryRoute(db,{refCode:'summer',name:'Summer',lineAccountId:'a'});
 const data=await getEntryRouteFunnel(db,route.id);
 expect(data).toMatchObject({friend_add_count:2,remainingCount:1,blockedCount:1,cv_count:1,conversionValueSum:2400,valuePerFriend:1200});
 expect(data.monthly).toEqual([{month:'2026-10',friendAddCount:1,remainingCount:1,blockedCount:0,conversionCount:1,conversionValueSum:2400},{month:'2026-09',friendAddCount:1,remainingCount:0,blockedCount:1,conversionCount:0,conversionValueSum:0}]);
 expect((await getEntryRouteFunnel(db,'missing')).valuePerFriend).toBeNull();
});
