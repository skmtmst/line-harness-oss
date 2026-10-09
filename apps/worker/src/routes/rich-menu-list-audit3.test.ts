import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) => ids.every(id=>id==='a') }));
import { richMenuGroups } from './rich-menu-groups.js';
let fixture: SqliteD1;
beforeEach(() => {
  fixture = createTestD1();
  for (const id of ['a','b']) fixture.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,'t','s')").run(id,id,id);
  const insert = fixture.raw.prepare("INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size,targeting_priority) VALUES(?,?,?,'menu','large',?)");
  for(let i=0;i<201;i++) insert.run(`g${String(i).padStart(3,'0')}`,'a',`Menu ${i}`,i);
  insert.run('hidden','b','Hidden',0);
  fixture.raw.exec(`INSERT INTO rich_menu_pages(id,group_id,order_index,name,alias_id,image_r2_key,image_content_type) VALUES('p','g150',0,'First','alias','thumb','image/png');
    INSERT INTO rich_menu_areas(id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data) VALUES('a1','p',0,0,10,10,'uri','{"uri":"https://example.com"}'),('a2','p',10,0,10,10,'uri','{"uri":"https://example.com"}')`);
});
afterEach(()=>fixture.raw.close());
function app() {
  // Real SQL, with the D1 100-bind boundary enforced at the binding boundary.
  const db = {
    ...fixture.db,
    prepare(sql: string) {
      const prepared = fixture.db.prepare(sql);
      return new Proxy(prepared, { get(target,key) {
        if(key === 'bind') return (...values: unknown[]) => {
          if(values.length>100) throw new Error('too many SQL variables');
          return target.bind(...values);
        };
        return Reflect.get(target,key);
      } });
    },
  } as D1Database;
  const app = new Hono<Env>();
  app.use('*',async(c,next)=>{c.set('staff',{id:'owner',name:'Owner',role:'owner',readOnly:false});await next()});
  app.route('/',richMenuGroups);
  return { app, env: {DB:db} as Env['Bindings'] };
}
test('WEB222 201 menus retain totals, order, thumbnail and shape with <=100 SQL bindings',async()=>{
  const {app: instance,env}=app();
  const response=await instance.request('/api/rich-menu-groups?accountId=a&page=1&limit=200',{},env);
  expect(response.status).toBe(200);
  const body=await response.json() as any;
  expect(body.data.total).toBe(201); expect(body.data.items).toHaveLength(200);
  expect(body.data.items.find((item:any)=>item.id==='g150')).toMatchObject({pageCount:1,defaultPageAreaCount:2,thumbnailR2Key:'thumb'});
  expect(body.data.items[0].id).toBe('g000');
  const next=await (await instance.request('/api/rich-menu-groups?accountId=a&page=2&limit=200',{},env)).json() as any;
  expect(next.data.items.map((row:any)=>row.id)).toEqual(['g200']);
  expect((await instance.request('/api/rich-menu-groups?accountId=b&page=1&limit=200',{},env)).status).toBe(404);
});
