import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { createTrackedLink, updateTrackedLink } from '../src/tracked-links.js';
import { createBroadcastMessageAsset, saveBroadcastMessageAssetDraft } from '../src/broadcast-message-assets.js';
import { createWebinar } from '../src/webinars/definitions.js';
import { createScheduledChatSend, updateScheduledChatSend } from '../src/scheduled-chat-sends.js';

it('店を指定しない共通の保存も操作する統括で画像を照合する', async () => {
  const raw=new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
    raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES('a','t1','a','A','x','x'),('b','t2','b','B','x','x');
      INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key) VALUES('own','a','image','a','image/png',1,'images/own.png'),('other','b','image','b','image/png',1,'images/other.png');`);
    const db=asD1(raw), own='https://cdn.test/images/own.png', other='https://cdn.test/images/other.png';
    const link=await createTrackedLink(db,{name:'仮',originalUrl:'https://example.test',lineAccountId:null,ogImageUrl:own,tenantId:'t1'});
    await updateTrackedLink(db,link.id,{ogImageUrl:own,tenantId:'t1'});
    await expect(createTrackedLink(db,{name:'仮',originalUrl:'https://example.test/foreign',lineAccountId:null,ogImageUrl:other,tenantId:'t1'})).rejects.toThrow('media_cross_tenant_reference');
    await expect(updateTrackedLink(db,link.id,{ogImageUrl:other,tenantId:'t1'})).rejects.toThrow('media_cross_tenant_reference');
    const asset=await createBroadcastMessageAsset(db,{kind:'rich_message',name:'仮',payloadJson:JSON.stringify({image:own}),tenantId:'t1'});
    await saveBroadcastMessageAssetDraft(db,asset!.id,{payloadJson:JSON.stringify({image:own}),tenantId:'t1'});
    await expect(createBroadcastMessageAsset(db,{kind:'rich_message',name:'仮',payloadJson:JSON.stringify({image:other}),tenantId:'t1'})).rejects.toThrow('media_cross_tenant_reference');
    await expect(saveBroadcastMessageAssetDraft(db,asset!.id,{payloadJson:JSON.stringify({image:other}),tenantId:'t1'})).rejects.toThrow('media_cross_tenant_reference');
    await createWebinar(db,{title:'仮',slug:'one',videoPrefix:own,tenantId:'t1'});
    await expect(createWebinar(db,{title:'仮',slug:'two',videoPrefix:other,tenantId:'t1'})).rejects.toThrow('media_cross_tenant_reference');
    const scheduled={id:'one',friendId:'f',lineAccountId:null,staffId:'staff',messageType:'image',content:own,quotedMessageId:null,idempotencyKey:'one',scheduledAt:'2027-01-01T00:00:00Z',tenantId:'t1'};
    await createScheduledChatSend(db,scheduled);
    await expect(updateScheduledChatSend(db,{id:'one',friendId:'f',content:own,tenantId:'t1'})).resolves.toBe('updated');
    await expect(createScheduledChatSend(db,{...scheduled,id:'two',idempotencyKey:'two',content:other})).rejects.toThrow('media_cross_tenant_reference');
    await expect(updateScheduledChatSend(db,{id:'one',friendId:'f',content:other,tenantId:'t1'})).rejects.toThrow('media_cross_tenant_reference');
  } finally {raw.close();}
});
