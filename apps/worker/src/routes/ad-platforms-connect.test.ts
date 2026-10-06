import { Hono } from 'hono';
import { afterEach, expect,it,vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { adPlatforms } from './ad-platforms.js';
import type { Env } from '../index.js';
afterEach(()=>vi.unstubAllGlobals());
it('疎通成功だけ接続し、他所属・staff・外部失敗を拒む',async()=>{
 const {db,raw}=createTestD1();
 try {
  raw.exec(`INSERT INTO tenants(id,name) VALUES('t','tenant'); INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','c','a','token','secret','t'); INSERT INTO staff_members(id,name,role,tenant_id,account_scope,api_key) VALUES('o','o','owner','t','all','synthetic');
   INSERT INTO ad_platforms(id,name,config,line_account_id,is_active) VALUES('p','meta','{"ad_account_id":"123","pixel_id":"p","access_token":"synthetic"}','a',0);`);
  const request=(role='owner',tenant='t')=>{
   const a=new Hono<Env>();a.use('*',async(c,next)=>{c.set('staff',{id:'o',name:'o',role:role as 'owner',readOnly:false,tenantId:tenant});await next()});a.route('/',adPlatforms);
   return a.request('/api/ad-platforms/p/connect',{method:'POST'},{DB:db});
  };
  const remote=vi.fn(async()=>Response.json({data:[]}));vi.stubGlobal('fetch',remote);
  expect((await request('staff')).status).toBe(403);expect((await request('owner','other')).status).toBe(404);expect(remote).not.toHaveBeenCalled();
  remote.mockResolvedValueOnce(new Response('secret-echo',{status:401}));
  const failed=await request();expect(failed.status).toBe(502);expect(await failed.text()).not.toContain('secret-echo');
  expect(raw.prepare('SELECT is_active,verified_at FROM ad_platforms').get()).toMatchObject({is_active:0,verified_at:null});
  expect((await request()).status).toBe(200);expect(raw.prepare('SELECT is_active FROM ad_platforms').get()).toEqual({is_active:1});
  expect(raw.prepare('SELECT COUNT(*) n FROM ad_conversion_logs').get()).toEqual({n:0});
 } finally{raw.close();}
});
