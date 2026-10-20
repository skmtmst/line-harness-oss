import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { getBroadcastListPage, getBroadcasts } from '../src/broadcasts/index.js';
import { deriveBroadcastDisplayStatus } from '../src/broadcast-ledger-display.js';
import { asD1 } from './d1-test-helper.js';
test('SCALE-01 状態の札・件数・フォルダ・ページ切替は元の10状態の契約を保つ', async()=>{
 const raw=new Database(':memory:');raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
 try {
 raw.pragma('foreign_keys=OFF');
 const db=asD1(raw), scope={allowedAccountIds:['a'],canSeeUnassigned:false};
 const cases=[
  {status:'draft'}, {status:'scheduled',scheduledAt:'2099-01-01'},
  {status:'scheduled',approvalStatus:'pending',scheduledAt:'2099-01-01'},
  {status:'scheduled',approvalStatus:'pending',scheduledAt:'2020-01-01'},
  {status:'sent',approvalStatus:'expired'}, {status:'sending',stopped:true},
  {status:'sending'}, {status:'sending',claimed:1},
  {status:'sent',sent:1}, {status:'sent',failed:1,sent:1}, {status:'sent',failed:1}, {status:'sent',unknown:1},
 ];
 for(const [i,item] of cases.entries()){
  const id='b'+i;
  raw.prepare("INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id,approval_status,scheduled_at,stopped_at,folder_id) VALUES(?,?,'text','人工','all',?,'a',?,?,?,?)")
   .run(id,id,item.status,item.approvalStatus??'none',item.scheduledAt??null,item.stopped?'2026-01-01':null,i%2?'folder':null);
  for(const state of ['sent','failed','unknown','claimed'] as const)if((item as Record<string,unknown>)[state])
   raw.prepare("INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,state) VALUES(?,?,'a',?)").run(id,'f-'+state,state);
 }
 const expected=cases.map(item=>deriveBroadcastDisplayStatus({...item,sent:item.sent??0,failed:item.failed??0,unknown:item.unknown??0,ledgerRows:(item.sent??0)+(item.failed??0)+(item.unknown??0)+(item.claimed??0),nowMs:Date.parse('2026-01-01')}));
 const counts:Record<string,number>={all:cases.length};for(const x of expected)counts[x]=(counts[x]??0)+1;
 for(const display of new Set(expected)){
  const page=await getBroadcastListPage(db,undefined,scope,{order:'desc',limit:1,offset:0,displayStatuses:[display],now:'2026-01-01'});
  expect(page.statusCounts).toEqual(counts);
  expect(page.total).toBe(expected.filter(x=>x===display).length);
  expect(page.items).toHaveLength(1);
  expect((page.items[0] as unknown as {display_status:string}).display_status).toBe(display);
 }
 const folder=await getBroadcastListPage(db,undefined,scope,{order:'asc',limit:3,offset:1,folderId:'folder',now:'2026-01-01'});
 expect(folder.statusCounts.all).toBe(6);expect(folder.items).toHaveLength(3);
 const due=await getBroadcasts(db,undefined,scope,{status:'scheduled',dueAt:'2026-01-01'});
 expect(due.map(x=>x.id)).toEqual(['b3']);
 }finally{raw.close();}
});
