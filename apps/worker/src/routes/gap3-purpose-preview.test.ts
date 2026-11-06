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

test('Q-10/PURPOSE-04: 同意の別名・非表示・LINE先なしの人数が保存した模擬配信と同じ',async()=>{
 const d=gapFixture();try{
 d.raw.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','宣伝','revoked','本人','liff');INSERT INTO friends(id,line_user_id,line_account_id,is_hidden) VALUES('hidden','Uhidden','a',1),('empty','','a',0)");
 const {saveSimulationDraft,simulationPreview}=await import('../features/broadcasts/broadcast-simulation.js');
 const id=(await saveSimulationDraft(d.db,'a','o','purpose-alias',{title:'確認',text:'本文',purpose:'marketing',testMode:true})).id;
 const r=await gapCall(gapApp(d,[deliveryPurposePreview]),'/api/delivery-purposes/preview?account_id=a','POST',{purpose:'marketing'});expect(r.status).toBe(200);const preview=(await r.json() as any).data;
 expect(preview).toMatchObject({recipients:1,excluded:{blocked:0,optedOut:1}});expect((await simulationPreview(d.db,id)).recipients).toBe(preview.recipients);
 }finally{d.raw.close();}
});
