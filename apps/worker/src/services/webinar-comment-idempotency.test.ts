import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { insertWebinarUserComment } from '@line-crm/db';
let test: SqliteD1;
beforeEach(() => {
  test=createTestD1({foreignKeys:true});
  test.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('a','店','ch','token','secret');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','u','a');
    INSERT INTO webinars(id,account_id,title,slug,created_at,updated_at) VALUES('w','a','見本','sample','sample','sample');`);
});
afterEach(()=>test.raw.close());
it('同じコメントIDの並行再送でも保存は1件になる', async () => {
  const comment={id:'comment-stable-key',webinarId:'w',friendId:'f',sessionStartAt:123,atSeconds:5,body:'見本'};
  await Promise.all([insertWebinarUserComment(test.db,comment),insertWebinarUserComment(test.db,comment)]);
  expect(test.raw.prepare('SELECT id,body FROM webinar_user_comments').all()).toEqual([{id:'comment-stable-key',body:'見本'}]);
});
it('同じIDは本人と配信に限って再送と認識し、内容違いを拒む', async () => {
  const { recordKeyedWebinarComment } = await import('./webinar-comment-idempotency.js');
  test.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f2','u2','a')");
  const comment={webinarId:'w',friendId:'f',sessionStartAt:123,atSeconds:5,body:'見本'};
  expect(await recordKeyedWebinarComment(test.db,comment,'same',60)).toBe('saved');
  expect(await recordKeyedWebinarComment(test.db,comment,'same',60)).toBe('duplicate');
  expect(await recordKeyedWebinarComment(test.db,{...comment,body:'別の内容'},'same',60)).toBe('conflict');
  expect(await recordKeyedWebinarComment(test.db,{...comment,friendId:'f2'},'same',60)).toBe('saved');
  expect(test.raw.prepare('SELECT COUNT(*) AS n FROM webinar_user_comments').get()).toEqual({n:2});
});
it('上限到達後も送信済みの再送を成功扱いにする', async () => {
  const { recordKeyedWebinarComment } = await import('./webinar-comment-idempotency.js');
  const comment={webinarId:'w',friendId:'f',sessionStartAt:123,atSeconds:5,body:'見本'};
  expect(await recordKeyedWebinarComment(test.db,comment,'first',1)).toBe('saved');
  expect(await recordKeyedWebinarComment(test.db,comment,'first',1)).toBe('duplicate');
  expect(await recordKeyedWebinarComment(test.db,comment,'second',1)).toBe('limit');
});
it('異なる内容が同じIDで競合しても一方のみ保存する', async () => {
  const { recordKeyedWebinarComment } = await import('./webinar-comment-idempotency.js');
  const comment={webinarId:'w',friendId:'f',sessionStartAt:123,atSeconds:5,body:'見本'};
  const results=await Promise.all([recordKeyedWebinarComment(test.db,comment,'same',60),recordKeyedWebinarComment(test.db,{...comment,body:'他の内容'},'same',60)]);
  expect(results.sort()).toEqual(['conflict','saved']);
  expect(test.raw.prepare('SELECT COUNT(*) AS n FROM webinar_user_comments').get()).toEqual({n:1});
});
