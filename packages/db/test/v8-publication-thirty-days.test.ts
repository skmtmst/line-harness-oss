import Database from 'better-sqlite3';import { readFileSync } from 'node:fs';import { expect,it } from 'vitest';
import { asD1 } from './d1-test-helper.js';import { savePublicationDailyViews,getPublicationThirtyDayViews } from '../src/photo-publication-views.js';
it('counts UTC inclusive 30 days, takes daily maxima, and keeps account scope',async()=>{
 const raw=new Database(':memory:');raw.exec(readFileSync('bootstrap.sql','utf8'));const db=asD1(raw);
 raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','a','A','token','secret');
 INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','U1','a');
 INSERT INTO nen_pet_profiles(id,friend_id,name,created_at,updated_at) VALUES ('pet','f','Pet','2026-01-01','2026-01-01');
 INSERT INTO nen_photo_submissions(id,friend_id,pet_id,line_account_id,r2_key,image_url,content_type,status,created_at,updated_at) VALUES ('photo','f','pet','a','r2','https://example.test/photo','image/jpeg','adopted','2026-01-01','2026-01-01');
 INSERT INTO nen_photo_publications(id,photo_id,line_account_id,status,published_at,updated_at) VALUES ('p','photo','a','published','2026-01-01','2026-01-01');`);
 const save=(viewDate:string,viewCount:number,placementLabel='')=>savePublicationDailyViews(db,{publicationId:'p',lineAccountId:'a',viewDate,viewCount,placementLabel,now:'2026-10-04'});
 await save('2026-09-05',4);await save('2026-09-04',9000);await save('2026-10-04',20);await save('2026-10-04',10);
 await save('2026-10-04',20,'Site A'); // The unlabelled total already includes the labelled site.
 await save('2026-10-01',2,'A');await save('2026-10-01',3,'B');
 expect((await getPublicationThirtyDayViews(db,'a',new Date('2026-10-04T00:00:00Z'))).get('p')).toBe(29);
 expect((await getPublicationThirtyDayViews(db,'b',new Date('2026-10-04T00:00:00Z'))).size).toBe(0);
 expect((await getPublicationThirtyDayViews(db,'a',new Date('2027-01-01T00:00:00Z'))).get('p')).toBe(0);
});
