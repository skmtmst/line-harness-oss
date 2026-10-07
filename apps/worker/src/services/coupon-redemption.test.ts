import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {redeemCoupon} from './coupon-redemption.js';
import type {Friend} from '@line-crm/db';
let test:SqliteD1;
const payload={description:'500円引き',startsAt:'2026-10-01T00:00',endsAt:'2026-11-01T00:00',oncePerFriend:true};
const friend={id:'f',line_account_id:'a'} as Friend;
beforeEach(()=>{
  test=createTestD1();
  test.raw.prepare(`INSERT INTO broadcast_message_assets (id,line_account_id,kind,name,payload_json,published_version,created_at,updated_at) VALUES ('c','a','coupon','クーポン',?,1,'2026-10-01','2026-10-01')`).run(JSON.stringify(payload));
});
afterEach(()=>test.raw.close());
const now=new Date('2026-10-07T00:00:00+09:00');
describe('クーポンの使用記録（実SQLite）',()=>{
 it('誰がいつ何回使ったかを残し、再送は同じ結果、次のイベントは上限で止める',async()=>{
  expect((await redeemCoupon(test.db,friend,'a','c','e1',now)).ok).toBe(true);
  expect((await redeemCoupon(test.db,friend,'a','c','e1',now)).replayed).toBe(true);
  expect((await redeemCoupon(test.db,friend,'a','c','e2',now)).message).toContain('回数');
  const rows=test.raw.prepare('SELECT * FROM coupon_redemptions').all() as Array<{friend_id:string;use_number:number;used_at:string}>;
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({friend_id:'f',use_number:1});expect(rows[0].used_at).toBe('2026-10-07T00:00:00.000+09:00');
 });
 it('期限の開始より前・終了ちょうど・別アカウント・未公開では使えない',async()=>{
  expect((await redeemCoupon(test.db,friend,'a','c','e1',new Date('2026-09-30T23:59:59+09:00'))).ok).toBe(false);
  expect((await redeemCoupon(test.db,friend,'a','c','e2',new Date('2026-11-01T00:00:00+09:00'))).message).toContain('期限');
  expect((await redeemCoupon(test.db,friend,'b','c','e3',now)).ok).toBe(false);
  test.raw.exec("UPDATE broadcast_message_assets SET published_version=0 WHERE id='c'");
  expect((await redeemCoupon(test.db,friend,'a','c','e4',now)).ok).toBe(false);
  expect(test.raw.prepare('SELECT COUNT(*) AS n FROM coupon_redemptions').get()).toEqual({n:0});
 });
 it('別の人は使え、同時の最後の1回は片方だけ成功する',async()=>{
  const results=await Promise.all([redeemCoupon(test.db,friend,'a','c','e1',now),redeemCoupon(test.db,friend,'a','c','e2',now)]);
  expect(results.filter(result=>result.ok)).toHaveLength(1);
  expect((await redeemCoupon(test.db,{...friend,id:'f2'},'a','c','e3',now)).ok).toBe(true);
 });
 it('素材を削除しても過去の使用の記録を残す',async()=>{
  test.raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('a','試験','ch','test-token','test-secret'); INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','u','a')");
  test.raw.pragma('foreign_keys=ON');
  await redeemCoupon(test.db,friend,'a','c','e1',now);
  test.raw.exec("DELETE FROM broadcast_message_assets WHERE id='c'");
  expect(test.raw.prepare('SELECT asset_id,payload_snapshot FROM coupon_redemptions').get()).toMatchObject({asset_id:'c',payload_snapshot:JSON.stringify(payload)});
  expect((await redeemCoupon(test.db,friend,'a','c','e2',now)).ok).toBe(false);
 });
 it('2回まで・期間中何回でもの設定を守る',async()=>{
  test.raw.prepare("UPDATE broadcast_message_assets SET payload_json=? WHERE id='c'").run(JSON.stringify({...payload,maxUsesPerFriend:2}));
  expect((await redeemCoupon(test.db,friend,'a','c','e1',now)).ok).toBe(true);
  expect((await redeemCoupon(test.db,friend,'a','c','e2',now)).ok).toBe(true);
  expect((await redeemCoupon(test.db,friend,'a','c','e3',now)).ok).toBe(false);
  test.raw.prepare("UPDATE broadcast_message_assets SET payload_json=? WHERE id='c'").run(JSON.stringify({...payload,oncePerFriend:false}));
  expect((await redeemCoupon(test.db,friend,'a','c','e4',now)).ok).toBe(true);
 });
});
