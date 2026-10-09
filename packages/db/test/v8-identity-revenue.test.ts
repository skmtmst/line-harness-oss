import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { listEcIdentityCandidates } from '../src/ec-operations.js';
it('sums every pending customer once regardless of page and excludes other accounts',async()=>{
 const raw=new Database(':memory:');raw.exec(readFileSync('bootstrap.sql','utf8'));const db=asD1(raw);
 raw.exec(`INSERT INTO tenants(id,name) VALUES ('t','Tenant');
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('a','a','A','token','secret','t'),('b','b','B','token','secret','t');
 INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES ('f','U1','a','Friend');`);
 const candidate=(id:string,customer:string,value:number|null,account='a')=>raw.prepare(`INSERT INTO identity_candidates
 (id,tenant_id,kind,status,confidence_score,detector_version,left_subject_kind,left_subject_id,left_line_account_id,left_shop_key,left_snapshot_json,right_subject_kind,right_subject_id,right_line_account_id,right_snapshot_json,source_key,external_customer_id,evidence_fingerprint,evidence_json,impact_json,detected_at,created_at,updated_at)
 VALUES (?,'t','ec_member','pending',90,'v1','ec_event',?,?,'shop','{}','friend',?,?,'{}','eccube',?,'e','[]',?,'2026-10-01','2026-10-01','2026-10-01')`).run(id,id,account,account==='b'?'fb':'f',account,customer,JSON.stringify([{key:'sales',value,unit:'円'}]));
 candidate('c1','customer1',100);candidate('c2','customer1',100);candidate('c3','customer2',200);
 // scope guard: use a separate friend in B to satisfy the schema's same-account constraint.
 raw.exec(`INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('fb','U2','b')`);
 candidate('outside','customer1',9999,'b');
 raw.prepare(`INSERT INTO ec_events(id,source,external_event_id,event_type,line_account_id,customer_id,payload,status,received_at,updated_at)
 VALUES ('e1','eccube','e1','ec.order.confirmed','a','no-candidate','{}','identity_pending','2026-10-01','2026-10-01')`).run();
 const get=(offset:number)=>listEcIdentityCandidates(db,{tenantId:'t',lineAccountId:'a',status:'pending',limit:1,offset});
 expect((await get(0)).summary).toMatchObject({potentialRevenue:300,candidateExternalCustomers:2,withoutCandidates:1});
 expect((await get(100)).summary.potentialRevenue).toBe(300);
 // WEB196: multiplicity is independent of confidence and includes rows on other pages.
 raw.prepare("UPDATE identity_candidates SET confidence_score=60 WHERE id='c3'").run();
 const single = (await get(0)).items[0];
 const second = (await get(1)).items[0];
 const first = (await get(2)).items[0];
 expect(single).toMatchObject({ duplicateCandidateCount: 1, isDuplicateSuspicion: false });
 expect(second).toMatchObject({ duplicateCandidateCount: 2, isDuplicateSuspicion: true });
 expect(first.duplicateGroupKey).toBe(second.duplicateGroupKey);
 expect(single.duplicateGroupKey).not.toBe(first.duplicateGroupKey);
 expect(first.duplicateGroupKey).toMatch(/^[a-f0-9]{64}$/);
 expect(JSON.stringify(first)).not.toContain('customer1');
 expect((await get(0)).summary.duplicateSuspicions).toBe(1);
 candidate('unknown','customer3',null);expect((await get(0)).summary.potentialRevenue).toBeNull();
});
