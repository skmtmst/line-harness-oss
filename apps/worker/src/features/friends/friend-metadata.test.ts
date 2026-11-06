import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { patchFriendMetadata } from './friend-metadata.js';
let fixture:SqliteD1;
beforeEach(()=>{fixture=createTestD1();insertFriend(fixture.raw,'f',{metadata:'{"original":{"nested":true}}',line_account_id:'a'});});
afterEach(()=>fixture.raw.close());
const read=()=>JSON.parse((fixture.raw.prepare("SELECT metadata FROM friends WHERE id='f'").get() as {metadata:string}).metadata);
test('CS-C01: 2更新、特殊な項目名、配列・真偽・nullを保持する',async()=>{
 await Promise.all([patchFriendMetadata(fixture.db,'f',{'a."\\key':[1,'x'],nil:null}),patchFriendMetadata(fixture.db,'f',{right:{value:true},flag:false})]);
 expect(read()).toEqual({original:{nested:true},'a."\\key':[1,'x'],nil:null,right:{value:true},flag:false});
 await patchFriendMetadata(fixture.db,'f',{nil:null,flag:null},{deleteNull:true});
 expect(read()).not.toHaveProperty('nil');expect(read()).not.toHaveProperty('flag');
});
test('CS-C01: 古い版・別アカウント・サイズ超過を更新せず、初回項目は一度だけ',async()=>{
 expect(await patchFriendMetadata(fixture.db,'f',{x:'bad'},{expectedUpdatedAt:'old'})).toBe(false);
 expect(await patchFriendMetadata(fixture.db,'f',{x:'bad'},{lineAccountId:'other'})).toBe(false);
 expect(await patchFriendMetadata(fixture.db,'f',{large:'あ'.repeat(100)},{maxBytes:100})).toBe(false);
 expect(await patchFriendMetadata(fixture.db,'f',{ig_account_id:'first'},{firstTouchKeys:['ig_account_id']})).toBe(true);
 expect(await patchFriendMetadata(fixture.db,'f',{ig_account_id:'second'},{firstTouchKeys:['ig_account_id']})).toBe(false);
 expect(read()).toEqual({original:{nested:true},ig_account_id:'first'});
});
