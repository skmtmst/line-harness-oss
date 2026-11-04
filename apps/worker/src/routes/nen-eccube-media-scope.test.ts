import { expect, test } from 'vitest';
import { Hono } from 'hono';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { nenCampaigns } from './nen-campaigns.js';

const secret = 'a'.repeat(32);
test('EC同期は宛先不明の登録画像だけを拒み、他の内容と既存画像を保つ', async () => {
  const { db, raw } = createTestD1({ foreignKeys: false });
  try {
    raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','A','x','x','t1'),('b','b','B','x','x','t2');
      INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind) VALUES('own','a','images/own.png','own.png','image/png',1,'image');`);
    const app = new Hono<{Bindings:{DB:D1Database;ECCUBE_WEBHOOK_SECRET:string}}>();
    app.route('/', nenCampaigns);
    const post = async (payload: Record<string,unknown>) => {
      const body=JSON.stringify(payload), timestamp=String(Math.floor(Date.now()/1000));
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`))),b=>b.toString(16).padStart(2,'0')).join('');
      return app.request('/api/integrations/eccube/columns',{method:'POST',headers:{'content-type':'application/json','x-nen-timestamp':timestamp,'x-nen-signature':`sha256=${signature}`},body},{DB:db,ECCUBE_WEBHOOK_SECRET:secret});
    };
    const base={slug:'article',title:'old',article_url:'https://example.invalid/article',image_url:'https://external.invalid/photo.png'};
    expect((await post(base)).status).toBe(200);
    const response=await post({...base,title:'new',image_url:'https://example.invalid/images/own.png'});
    expect(response.status).toBe(200);
    const result=await response.json();
    expect(result).toMatchObject({success:true,data:{imageRejection:{reasonCode:'MEDIA_TENANT_UNDETERMINED',count:1}}});
    expect(JSON.stringify(result)).not.toContain('images/own.png');
    const receipt=raw.prepare("SELECT tenant_id,reason,detail FROM platform_audit_logs WHERE action='eccube.column.image_rejected'").get();
    expect(receipt).toEqual({tenant_id:null,reason:'MEDIA_TENANT_UNDETERMINED',detail:'{\"count\":1}'});
    expect(JSON.stringify(receipt)).not.toContain('images/own.png');
    expect(raw.prepare("SELECT title,image_url FROM nen_columns WHERE slug='article'").get()).toEqual({title:'new',image_url:'https://external.invalid/photo.png'});
    const own=await post({...base,slug:'own',line_account_id:'a',image_url:'https://example.invalid/images/own.png'});
    expect(own.status).toBe(200);
    expect(raw.prepare("SELECT image_url FROM nen_columns WHERE slug='own'").get()).toEqual({image_url:'https://example.invalid/images/own.png'});
    const other=await post({...base,slug:'other',line_account_id:'b',image_url:'https://example.invalid/images/own.png'});
    expect(other.status).toBeGreaterThanOrEqual(400);
    expect(raw.prepare("SELECT id FROM nen_columns WHERE slug='other'").get()).toBeUndefined();
  } finally {raw.close();}
});
