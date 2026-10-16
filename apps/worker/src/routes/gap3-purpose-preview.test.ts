import {expect,test} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {deliveryPurposePreview} from './delivery-purpose-preview.js';
test('GAP3-PURPOSE-01: 取引・お知らせ・宣伝を分けて本人の停止だけを数え、送信しない',async()=>{
 const d=gapFixture();try{
 d.raw.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','marketing','revoked','本人','liff'),('a','f2','notice','revoked','本人','liff')");
 const a=gapApp(d,[deliveryPurposePreview],{...gapOwner,readOnly:true});
 for(const [purpose,count]of [['transaction',2],['notice',1],['marketing',1]]as const){const r=await gapCall(a,'/api/delivery-purposes/preview?account_id=a','POST',{purpose});expect(r.status).toBe(200);expect((await r.json() as any).data).toMatchObject({purpose,recipients:count,sent:false,previewOnly:true});}
 expect(d.raw.prepare('SELECT count(*) n FROM messages_log').get()).toEqual({n:0});expect((await gapCall(a,'/api/delivery-purposes?account_id=b')).status).toBe(404);
 }finally{d.raw.close();}
});
