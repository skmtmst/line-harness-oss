import { expect, it } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import { countSentMediaMessages, findDirectMediaUsages } from './direct-media-usages.js';

it('台帳にない画像参照を確認し、他アカウントの個別情報を返さない', async () => {
  const fixture = createTestD1({ foreignKeys: false });
  try {
    fixture.raw.exec(`
      INSERT INTO tenants(id,name,logo_media_id) VALUES('tenant-x','非公開の会社名','m');
      INSERT INTO line_senders(id,account_id,name,icon_media_id,visibility,created_by,updated_at,idempotency_key,request_json)
        VALUES('sender-x','other','非公開の担当者名','m','all','staff','now','key','{}');
      INSERT INTO rt_google_posts(id,store_id,kind,summary,media_json,instagram_media_id)
        VALUES('post-x','other-store','standard','非公開の投稿','[{"mediaId":"m"}]','m');
      INSERT INTO rt_google_changes(id,store_id,kind,source,summary,target_json,after_json)
        VALUES('profile-x','other-store','photo','photo','非公開の写真','{}','{"mediaId":"m"}');
      INSERT INTO friend_field_values(friend_id,field_id,value,media_id)
        VALUES('private-friend','field','非公開の値','m');
      INSERT INTO visit_stamp_paper_requests(id,card_id,friend_id,line_account_id,photo_url,stamps)
        VALUES('paper-x','other-card','private-friend','other','https://example.test/object-key',1);
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,og_default_image_url)
        VALUES('other-account','other-channel','非公開','token','secret','https://example.test/object-key');
    `);
    const rows = await findDirectMediaUsages(fixture.db, { id: 'm', r2_key: 'object-key' }, 'account-a');
    expect(rows.map(row => row.refKind).sort()).toEqual(['company_logo','friend_field','google_post','google_profile_photo','line_sender_icon','other_image_setting','visit_stamp_photo']);
    expect(JSON.stringify(rows)).not.toMatch(/非公開|private-friend|sender-x|post-x|profile-x/);
    fixture.raw.exec("DELETE FROM tenants WHERE id='tenant-x'; DELETE FROM line_senders WHERE id='sender-x'; DELETE FROM rt_google_posts WHERE id='post-x'; DELETE FROM rt_google_changes WHERE id='profile-x'; DELETE FROM friend_field_values WHERE friend_id='private-friend'; DELETE FROM visit_stamp_paper_requests WHERE id='paper-x'; DELETE FROM line_accounts WHERE id='other-account'");
    expect(await findDirectMediaUsages(fixture.db, { id: 'm', r2_key: 'object-key' }, 'account-a')).toEqual([]);
  } finally { fixture.raw.close(); }
});

it('過去のイベント公開版と予約の保存内容も削除前に確かめる', async () => {
  const fixture = createTestD1({ foreignKeys: false });
  try {
    fixture.raw.exec(`INSERT INTO event_versions(id,event_id,line_account_id,version_number,snapshot_json,approval_deadline_hours,published_at)
      VALUES('old','e','a',1,'{"imageUrl":"https://example.test/object-key"}',24,'now');
      INSERT INTO event_bookings(id,line_account_id,event_id,slot_id,friend_id,status,requested_at,event_snapshot_json)
      VALUES('booking','a','e','s','friend','confirmed','now','{"eventImageUrl":"https://example.test/object-key"}');`);
    const rows = await findDirectMediaUsages(fixture.db, { id:'m', r2_key:'object-key' }, 'a');
    expect(rows.map(row=>row.name)).toEqual(expect.arrayContaining(['イベントの公開版（1件）','イベント予約の保存内容（1件）']));
  } finally { fixture.raw.close(); }
});

it('他アカウントの自動応答とスタンプカードも名前を伏せて確認する', async () => {
  const fixture=createTestD1({foreignKeys:false});
  try {
    fixture.raw.exec(`INSERT INTO auto_replies(id,keyword,response_content,line_account_id,name) VALUES('reply','秘密の語','https://example.test/object-key','other','秘密の名前');
      INSERT INTO visit_stamp_cards(id,tenant_id,name,settings_json) VALUES('card','tenant','秘密のカード','{"image":"object-key"}');`);
    const rows=await findDirectMediaUsages(fixture.db,{id:'m',r2_key:'object-key'},'a');
    expect(rows.map(row=>row.name)).toEqual(expect.arrayContaining(['他アカウントの自動応答（1件）','他アカウントの来店スタンプ（1件）']));
    expect(JSON.stringify(rows)).not.toContain('秘密');
  } finally {fixture.raw.close();}
});

it('削除中の画像を顧客通知の下書きに登録しない', async () => {
  const fixture=createTestD1({foreignKeys:false});
  try {
    fixture.raw.exec(`INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,created_at,updated_at)
      VALUES('m','a','["object-key"]','checking','now','now');`);
    const {createCustomerNotificationDefinition}=await import('@line-crm/db');
    await expect(createCustomerNotificationDefinition(fixture.db,{lineAccountId:'a',key:'notice',name:'通知',category:'general',sourceEventType:'test',draftConfig:{imageUrl:'https://example.test/object-key'},staffId:'staff'})).rejects.toThrow('media_deletion_in_progress');
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM customer_notification_definitions').get()).toEqual({n:0});
  } finally {fixture.raw.close();}
});


it('送信済みは削除を妨げず、取消済みを除き匿名の件数だけを返す', async () => {
  const fixture = createTestD1({ foreignKeys: false });
  try {
    fixture.raw.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,unsent_at) VALUES
      ('sent1','private-friend','outgoing','image','https://example.test/object-key',NULL),
      ('sent2','private-friend','outgoing','image','https://example.test/media/m/content',NULL),
      ('unsent','private-friend','outgoing','image','https://example.test/object-key','now'),
      ('received','private-friend','incoming','image','https://example.test/object-key',NULL);`);
    const media = { id: 'm', r2_key: 'object-key' };
    expect(await findDirectMediaUsages(fixture.db, media, 'a')).toEqual([]);
    expect(await countSentMediaMessages(fixture.db, media)).toBe(2);
  } finally { fixture.raw.close(); }
});

it('送信予約と送信中は削除を止め、送信済みになれば使用先から外れる', async () => {
  const f = createTestD1({ foreignKeys: false });
  try {
    f.raw.exec(`INSERT INTO scheduled_chat_sends(id,friend_id,line_account_id,staff_id,message_type,content,idempotency_key,scheduled_at,status,created_at,updated_at)
      VALUES('schedule','friend','a','staff','image','https://cdn.test/object-key','key','2026-01-01','scheduled','now','now');`);
    const media = { id: 'm', r2_key: 'object-key' };
    for (const status of ['scheduled', 'sending']) {
      f.raw.prepare('UPDATE scheduled_chat_sends SET status=?').run(status);
      expect((await findDirectMediaUsages(f.db,media,'a')).map(row=>row.name)).toContain('予約したチャット送信（1件）');
    }
    f.raw.exec("UPDATE scheduled_chat_sends SET status='sent'");
    expect(await findDirectMediaUsages(f.db,media,'a')).toEqual([]);
  } finally { f.raw.close(); }
});

it('共通情報の値・変更予約・過去の版を確認し、削除中は登録しない', async () => {
  const f = createTestD1({ foreignKeys: false });
  try {
    const {createCommonVar,createCommonVarSchedule}=await import('@line-crm/db');
    const variable=await createCommonVar(f.db,{name:'画像',lineAccountId:'a',varKey:'image',value:'https://cdn.test/object-key'});
    await createCommonVarSchedule(f.db,{varId:variable.id,effectiveFrom:'2027-01-01',value:'https://cdn.test/object-key'});
    const rows=await findDirectMediaUsages(f.db,{id:'m',r2_key:'object-key'},'a');
    expect(rows.map(row=>row.name)).toEqual(expect.arrayContaining(['共通情報（1件）','共通情報の変更予約（1件）','共通情報の版（1件）']));
    f.raw.exec(`INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,created_at,updated_at) VALUES('m','a','["object-key"]','checking','now','now')`);
    await expect(createCommonVar(f.db,{name:'別',lineAccountId:'a',varKey:'other',value:'https://cdn.test/object-key'})).rejects.toThrow('media_deletion_in_progress');
    await expect(createCommonVarSchedule(f.db,{varId:variable.id,effectiveFrom:'2027-02-01',value:'https://cdn.test/object-key'})).rejects.toThrow('media_deletion_in_progress');
  } finally {f.raw.close();}
});

it('削除の確保後は画像を使うチャットの予約を追加できない', async () => {
  const f=createTestD1({foreignKeys:false});
  try {
    f.raw.exec(`INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,created_at,updated_at) VALUES('m','a','["object-key"]','checking','now','now')`);
    const {createScheduledChatSend}=await import('@line-crm/db');
    await expect(createScheduledChatSend(f.db,{id:'schedule',friendId:'f',lineAccountId:'a',staffId:'staff',messageType:'image',content:'https://cdn.test/object-key',quotedMessageId:null,idempotencyKey:'key',scheduledAt:'2027-01-01T00:00:00.000Z'})).rejects.toThrow('media_deletion_in_progress');
    expect(f.raw.prepare('SELECT count(*) n FROM scheduled_chat_sends').get()).toEqual({n:0});
  } finally {f.raw.close();}
});

it('初期セットの設定と保存内容も確認する', async () => {
 const f=createTestD1({foreignKeys:false});
 try {
  f.raw.exec(`INSERT INTO style_starter_sets(id,style,name,definition_json,updated_at) VALUES('set','restaurant','セット','{"image":"https://cdn.test/object-key"}','now');
    INSERT INTO style_starter_items(line_account_id,style,item_key,kind,target_id,set_version,applied_at,pending_update) VALUES('a','restaurant','one','template','target',1,'now','{"image":"https://cdn.test/object-key"}');
    INSERT INTO style_starter_catalog_resources(tenant_id,line_account_id,resource_kind,target_id,source_snapshot,updated_at) VALUES('tenant','a','template','target','{"image":"https://cdn.test/object-key"}','now');`);
  const names=(await findDirectMediaUsages(f.db,{id:'m',r2_key:'object-key'},'a')).map(row=>row.name);
  expect(names).toEqual(expect.arrayContaining(['初期セット（1件）','初期セットの保存内容（1件）','初期セットの配布記録（1件）']));
 } finally {f.raw.close();}
});
