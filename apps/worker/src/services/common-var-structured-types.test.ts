import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { expandSendCommonVars } from './interpolation-context.js';
import { buildMessage } from './line-message.js';
let f:SqliteD1;
const value='引用"と改行\nと\\と{{var.other}}';
beforeEach(()=>{
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external access forbidden');}));
  f=createTestD1();f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','ch','fixture','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Uf','a');`);
  f.raw.prepare(`INSERT INTO common_vars(id,line_account_id,name,var_key,value) VALUES ('v','a','fixture','label',?)`).run(value);
});
afterEach(()=>{f.raw.close();vi.unstubAllGlobals();});
for(const messageType of ['flex','carousel','location','image','video','audio','sticker','imagemap','rich_message','card_message','coupon','research']) {
  test(`D-08 ${messageType}: 引用符・改行・バックスラッシュをJSONの値として保つ`,async()=>{
    const content=JSON.stringify({title:'{{var.label}}',actions:[{text:'{{var.label}}'}],nested:{'{{var.key_only}}':'unchanged'},numeric:1});
    const expanded=await expandSendCommonVars(f.db,content,{kind:'form_reply',id:'form'},{friendId:'f',messageType});
    expect(JSON.parse(expanded)).toEqual({title:value,actions:[{text:value}],nested:{'{{var.key_only}}':'unchanged'},numeric:1});
  });
}
test('D-08 イメージマップを実際に組み立てても、本文が壊れない',async()=>{
  const content=JSON.stringify({baseUrl:'https://example.test/images/map',baseSize:{width:1040,height:1040},altText:'fixture',actions:[{type:'message',text:'{{var.label}}',area:{x:0,y:0,width:1040,height:1040}}]});
  const expanded=await expandSendCommonVars(f.db,content,{kind:'form_reply',id:'form'},{friendId:'f',messageType:'imagemap'});
  const message=buildMessage('imagemap',expanded);
  expect(message).toMatchObject({type:'imagemap',actions:[{type:'message',text:value}]});
});

test('D-08 JSONらしいテキストは本文のまま差し込み、構造を推測しない',async()=>{
  const text='{"label":"{{var.label}}"}';
  expect(await expandSendCommonVars(f.db,text,{kind:'form_reply',id:'form'},{friendId:'f',messageType:'text'})).toBe('{"label":"'+value+'"}');
});
