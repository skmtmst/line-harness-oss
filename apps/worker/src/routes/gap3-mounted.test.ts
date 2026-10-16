import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture} from '../test-utils/gap1.js';
import {app} from '../index.js';
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
test('GAP3-BOUNDARY-01: 実際にmountした認証・機能設定の後から追加APIへ到達できる',async()=>{
 const paths=['/api/member-ranks/program?account_id=a','/api/ec/auto-line/stats?account_id=a','/api/mcp-connections?account_id=a','/api/hq/store-comparison?from=2026-10-15&to=2026-10-15','/api/booking/admin/pass-purchases?account_id=a'];
 for(const path of paths){const r=await app.request(path,{headers:{Authorization:'Bearer owner-key'}},{DB:d.db} as any);expect(r.status,path+': '+await r.clone().text()).toBe(200);}
 const r=await app.request('/api/broadcasts/simulation-drafts?account_id=a',{method:'POST',headers:{Authorization:'Bearer owner-key','Content-Type':'application/json','Idempotency-Key':'mounted'},body:JSON.stringify({title:'確認',text:'本文',purpose:'notice',testMode:true})},{DB:d.db} as any);expect(r.status,await r.clone().text()).toBe(201);
 const webhook=await app.request('/api/booking/pass-payments/webhook',{method:'POST',body:'{}'},{DB:d.db} as any);expect(webhook.status).toBe(401);
});
