import { describe,test,expect } from 'vitest';
import { listRichMenuManualPublishRequests } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

describe('公開履歴の実行と版の対応',()=>{
 test('最新の版番号を全履歴へ付けず、同じ実行の版だけ返す。旧履歴はnull',async()=>{
   const f=createTestD1({foreignKeys:true});
   try {
     f.raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('account','店','account','test','test');INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size) VALUES('menu','account','案内','開く','large')");
     for(const n of [2,3])f.raw.prepare("INSERT INTO rich_menu_versions(id,group_id,version_number,definition_snapshot,definition_fingerprint) VALUES (?,'menu',?,'{}',?)").run(`v${n}`,n,`fingerprint${n}`);
     for(const n of [1,2,3])f.raw.prepare("INSERT INTO rich_menu_manual_publish_requests(id,group_id,account_id,definition_snapshot,request_fingerprint,idempotency_key,status,requested_by_staff_id,created_at,updated_at) VALUES (?,'menu','account','{}',?,?,'succeeded','owner',?,?)").run(`request${n}`,`fp${n}`,`key${n}`,`2026-10-0${n}`,`2026-10-0${n}`);
     for(const n of [2,3])f.raw.prepare("INSERT INTO rich_menu_publish_runs(id,group_id,version_id,idempotency_key,mode,status) VALUES (?,'menu',?,?,'publish','succeeded')").run(`run${n}`,`v${n}`,`key${n}`);
     const rows=await listRichMenuManualPublishRequests(f.db,'menu');
     expect(rows.map(r=>[r.id,r.version_number])).toEqual([['request3',3],['request2',2],['request1',null]]);
   } finally {f.raw.close()}
 });
});
