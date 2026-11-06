import { Hono } from 'hono';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { images } from './images.js';
let sql: ReturnType<typeof createTestD1>;
let objects: Map<string, any>, bucket: any, staff: any, app: Hono<Env>;
beforeEach(() => {
 sql = createTestD1();
 sql.raw.exec("INSERT INTO tenants(id,name) VALUES('ta','A'),('tb','B'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('a','A','ca','t','s','ta'),('b','B','cb','t','s','tb');");
 staff={id:'env-owner',name:'Owner',role:'owner',readOnly:false,tenantId:'ta'};
 objects=new Map([
 ['a.png',{customMetadata:{lineAccountId:'a',tenantId:'ta'},body:'image',httpMetadata:{contentType:'image/png'}}],
 ['b.png',{customMetadata:{lineAccountId:'b',tenantId:'tb'},body:'image'}],
 ['legacy.png',{body:'legacy'}],
 ['private/secret',{customMetadata:{lineAccountId:'a',tenantId:'ta'},body:'secret'}],
 ]);
 bucket={head:vi.fn(async(k:string)=>objects.get(k)??null),get:vi.fn(async(k:string)=>objects.get(k)??null),delete:vi.fn(async(k:string)=>objects.delete(k)),put:vi.fn(async(k:string,data:any,opts:any)=>objects.set(k,{...opts,body:data}))};
 app=new Hono<Env>(); app.use('*',async(c,next)=>{c.set('staff',staff); await next()});app.route('/',images);
});
afterEach(()=>sql.raw.close());
async function request(key:string,method='DELETE') {return app.request(`/api/images/${encodeURIComponent(key)}?account_id=a`,{method},{DB:sql.db,IMAGES:bucket} as any)}
test.each(['b.png','legacy.png','private/secret'])('rejects foreign, unknown or private key %s without deletion',async key=>{
 expect((await request(key)).status).toBe(404);expect(bucket.delete).not.toHaveBeenCalled();expect(objects.has(key)).toBe(true);
});
test('owner can delete its own image',async()=>{expect((await request('a.png')).status).toBe(200);expect(objects.has('a.png')).toBe(false)});
test('admin reads only images belonging to its accessible account',async()=>{
 expect((await request('a.png','GET')).status).toBe(200);expect((await request('b.png','GET')).status).toBe(404);
});
test('upload stores account ownership before publishing the URL',async()=>{
 const png=new Uint8Array(32);png.set([137,80,78,71,13,10,26,10]);const v=new DataView(png.buffer);v.setUint32(16,1);v.setUint32(20,1);
 const res=await app.request('/api/images?account_id=a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',mimeType:'image/png'})},{DB:sql.db,IMAGES:bucket} as any);
 expect(res.status).toBe(201);const body:any=await res.json();expect(objects.get(body.data.key).customMetadata).toMatchObject({lineAccountId:'a',tenantId:'ta'});
});

test('accountless upload from an existing multi-account client stays usable only by its creator',async()=>{
 sql.raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('a2','A2','ca2','t','s','ta')");
 const res=await app.request('/api/images',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',mimeType:'image/png'})},{DB:sql.db,IMAGES:bucket} as any);
 expect(res.status).toBe(201);
 const {data:{key}}=await res.json() as {data:{key:string}};
 expect(objects.get(key).customMetadata).toMatchObject({ownerStaffId:'env-owner',tenantId:'ta'});
 expect((await request(key,'GET')).status).toBe(200);
 staff={...staff,id:'other-staff'};
 expect((await request(key)).status).toBe(404);
 expect(objects.has(key)).toBe(true);
 staff={...staff,id:'env-owner',tenantId:'tb'};
 expect((await request(key,'GET')).status).toBe(404);
});
