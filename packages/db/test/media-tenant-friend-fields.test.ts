import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { setFriendFieldValue, setFriendFieldValuesBulk, setFriendFieldValuesForFriend } from '../src/friend-fields.js';

it('友だち情報の単件・一括・複数項目保存は別統括の画像を保存しない', async () => {
  const raw=new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
    raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','A','x','x','t1'),('b','b','B','x','x','t2');
      INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','U-f','a');
      INSERT INTO friend_fields(id,name,field_key,type,type_v6) VALUES('field','架空','field','text','image');
      INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind) VALUES('m','b','images/foreign.png','image.png','image/png',1,'image');`);
    const db=asD1(raw),url='https://example.test/images/foreign.png';
    await expect(setFriendFieldValue(db,{friendId:'f',fieldId:'field',value:'m',updatedBy:'x',field:{type:'image'}})).rejects.toThrow('media_cross_tenant_reference');
    await expect(setFriendFieldValuesBulk(db,{fieldId:'field',entries:[{friendId:'f',value:url}],fieldType:'image',updatedBy:'x',now:'now'})).rejects.toThrow('media_cross_tenant_reference');
    await expect(setFriendFieldValuesForFriend(db,{friendId:'f',entries:[{fieldId:'field',value:'m',type:'image'}],updatedBy:'x',now:'now'})).rejects.toThrow('media_cross_tenant_reference');
    expect(raw.prepare("SELECT COUNT(*) AS n FROM friend_field_values WHERE field_id='field'").get()).toEqual({n:0});
  } finally {raw.close();}
});

it('アカウント未設定の友だちも保存者の統括で画像を照合する', async () => {
  const raw=new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
    raw.exec(`INSERT INTO tenants(id,name) VALUES('t1','A'),('t2','B');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','A','x','x','t1'),('b','b','B','x','x','t2');
      INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','U-f',NULL);
      INSERT INTO friend_fields(id,name,field_key,type,type_v6) VALUES('field','架空','field','text','image');
      INSERT INTO media(id,line_account_id,r2_key,filename,mime_type,size_bytes,kind) VALUES('own','a','images/own.png','own.png','image/png',1,'image'),('other','b','images/other.png','other.png','image/png',1,'image');`);
    const db=asD1(raw);
    const save=(value:string) => setFriendFieldValuesForFriend(db,{friendId:'f',entries:[{fieldId:'field',value,type:'image'}],updatedBy:'x',now:'now',tenantId:'t1'});
    await expect(save('own')).resolves.toBe(1);
    await expect(save('other')).rejects.toThrow('media_cross_tenant_reference');
    expect(raw.prepare("SELECT value FROM friend_field_values WHERE friend_id='f' AND field_id='field'").get()).toEqual({value:'own'});
  } finally {raw.close();}
});
