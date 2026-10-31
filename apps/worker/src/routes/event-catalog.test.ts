import { Hono } from 'hono';
import { beforeEach, afterEach, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { registerLiffCatalog } from './events/register-liff-catalog.js';
import type { Env } from '../worker-env.js';
let f:ReturnType<typeof createTestD1>;
let app:Hono<Env>;
beforeEach(()=>{f=createTestD1();f.raw.pragma('foreign_keys=OFF');f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id) VALUES('a','a','A','fixture','fixture','liff-a'),('b','b','B','fixture','fixture','liff-b');`);app=new Hono<Env>();registerLiffCatalog(app)});
afterEach(()=>f.raw.close());
function event(id:string,account='a',published=1,tag:string|null=null) {
 f.raw.prepare(`INSERT INTO events(id,name,line_account_id,is_published,lifecycle_status,visible_tag_id,venue_url) VALUES(?,?,?,?,'published',?,'https://private.invalid/meeting')`).run(id,id,account,published,tag);
 f.raw.prepare(`INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity,is_active) VALUES(?,?,'2099-01-01T01:00:00Z','2099-01-01T02:00:00Z',5,1)`).run(id+'-slot',id);
}
const get=(query='')=>app.request('/api/liff/events?liffId=liff-a'+query,{}, {DB:f.db} as Env['Bindings']);
test('公開前・他アカウント・タグ限定・過去・削除枠を一覧へ混ぜず、参加用URLを返さない',async()=>{
 event('visible');event('draft','a',0);event('foreign','b');event('tag','a',1,'private-tag');event('past');event('deleted');
 f.raw.exec("UPDATE event_slots SET starts_at='2000-01-01T00:00:00Z' WHERE event_id='past'; UPDATE event_slots SET deleted_at=datetime('now') WHERE event_id='deleted';");
 const res=await get();expect(res.status).toBe(200);const body=await res.json() as {data?:unknown;items?:unknown};
 expect(JSON.stringify(body)).toContain('visible');expect(JSON.stringify(body)).not.toMatch(/draft|foreign|private-tag|private.invalid|past|deleted/);
});
test('51件以上は次のページへ進め、同じ件を重ねずアカウントを変えられない',async()=>{
 for(let i=0;i<52;i++)event('event-'+String(i).padStart(3,'0'));
 const first=await (await get()).json() as {data:{items:Array<{id:string}>;nextCursor:string}};
 const data=first.data??first as unknown as typeof first.data;
 expect(data.items).toHaveLength(50);
 const second=await (await get('&cursor='+encodeURIComponent(data.nextCursor))).json() as typeof first;
 const next=second.data??second as unknown as typeof second.data;
 expect(next.items).toHaveLength(2);expect(new Set([...data.items,...next.items].map(item=>item.id)).size).toBe(52);
 f.raw.exec("UPDATE line_accounts SET archived_at=datetime('now') WHERE id='a'");expect((await get()).status).toBe(400);
});
