import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { templates } from './templates.js';

/*
 * PERF-12: テンプレート選択は全件を読まない。検索・フォルダ・分類を
 * サーバー側で絞り込んでからページに切る。取りこぼし（最後の項目まで
 * 届く）・重複・フォルダ件数の一致を実SQLiteで確かめる。
 */
let db: SqliteD1;

beforeEach(() => {
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret')`).run();
  // テンプレートの置き場: f1(親) → f2(子)、別種の f9、他アカウントの fx。
  const folder = db.raw.prepare(`INSERT INTO folders (id, kind, name, parent_id) VALUES (?, 'template', ?, ?)`);
  folder.run('f1', '予約案内', null);
  folder.run('f2', '前日確認', 'f1');
  db.raw.prepare(`INSERT INTO folders (id, kind, name, parent_id) VALUES ('f9', 'tag', 'タグ用', null)`).run();
  const tpl = db.raw.prepare(`INSERT INTO templates
    (id, name, category, message_type, message_content, folder_id, line_account_id, created_at)
    VALUES (?, ?, 'general', ?, ?, ?, 'account-a', ?)`);
  tpl.run('tp-01', '予約の確認', 'text', 'ご予約ありがとうございます', 'f1', '2026-01-01T00:00:01Z');
  tpl.run('tp-02', '前日のお知らせ', 'text', '明日の来店予約です', 'f2', '2026-01-01T00:00:02Z');
  tpl.run('tp-03', '発送の連絡', 'text', 'ECの注文商品を発送しました', 'f2', '2026-01-01T00:00:03Z');
  tpl.run('tp-04', '挨拶', 'text', 'いつもありがとうございます', null, '2026-01-01T00:00:04Z');
  tpl.run('tp-05', '画像だけ', 'image', '{"originalContentUrl":"https://example.test/x.png","previewImageUrl":"https://example.test/x.png"}', null, '2026-01-01T00:00:05Z');
  // 別アカウントのテンプレートは混ざらない。
  db.raw.prepare(`INSERT INTO templates
    (id, name, category, message_type, message_content, folder_id, line_account_id, created_at)
    VALUES ('tp-x', '別店の挨拶', 'general', 'text', '別店です', null, 'account-b', '2026-01-01T00:00:06Z')`).run();
});

afterEach(() => {
  db.raw.close();
});

function app() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'reader-a', name: 'reader-a', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', templates);
  return app;
}

type Item = { id: string; name: string; messageType: string; folderId: string | null; monthlySendCount: number | null };
type Body = {
  success: boolean;
  data: { items: Item[]; total: number; limit: number; folderCounts?: Record<string, number> };
};

async function get(query: string) {
  const res = await app().request(`/api/templates?account_id=account-a&${query}`, {}, { DB: db.db });
  return res;
}

describe('PERF-12 テンプレート選択のサーバー絞り込み', () => {
  it('message_type=text で文字テンプレートだけ、ページで区切って最後まで届く', async () => {
    const res1 = await get('message_type=text&page=1&limit=3');
    expect(res1.status).toBe(200);
    const b1 = (await res1.json()) as Body;
    expect(b1.data.total).toBe(4);
    expect(b1.data.items).toHaveLength(3);
    expect(b1.data.items.every((t) => t.messageType === 'text')).toBe(true);

    const b2 = ((await (await get('message_type=text&page=2&limit=3')).json()) as Body).data;
    expect(b2.items).toHaveLength(1);
    // 2ページで4件に届き、重複しない。
    const ids = [...b1.data.items, ...b2.items].map((t) => t.id).sort();
    expect(ids).toEqual(['tp-01', 'tp-02', 'tp-03', 'tp-04']);
  });

  it('q は名前と本文をまたいで絞る', async () => {
    const byName = ((await (await get('message_type=text&page=1&limit=50&q=挨拶')).json()) as Body).data;
    expect(byName.items.map((t) => t.id)).toEqual(['tp-04']);
    const byBody = ((await (await get('message_type=text&page=1&limit=50&q=発送')).json()) as Body).data;
    expect(byBody.items.map((t) => t.id)).toEqual(['tp-03']);
  });

  it('folder_id は指定フォルダと直下の子を含み、__none__ は未分類だけ', async () => {
    const f1 = ((await (await get('message_type=text&page=1&limit=50&folder_id=f1')).json()) as Body).data;
    expect(f1.items.map((t) => t.id).sort()).toEqual(['tp-01', 'tp-02', 'tp-03']);
    const none = ((await (await get('message_type=text&page=1&limit=50&folder_id=__none__')).json()) as Body).data;
    expect(none.items.map((t) => t.id)).toEqual(['tp-04']);
  });

  it('quick=reservation / ec は名称・本文のキーワード一致', async () => {
    const reservation = ((await (await get('message_type=text&page=1&limit=50&quick=reservation')).json()) as Body).data;
    expect(reservation.items.map((t) => t.id).sort()).toEqual(['tp-01', 'tp-02']);
    const ec = ((await (await get('message_type=text&page=1&limit=50&quick=ec')).json()) as Body).data;
    expect(ec.items.map((t) => t.id)).toEqual(['tp-03']);
    const bad = await get('page=1&limit=50&quick=bogus');
    expect(bad.status).toBe(400);
  });

  it('quick=frequent は送信実績の多い順で返す', async () => {
    db.raw.prepare(`INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('fr-1', 'u-1', '友だち', 'account-a')`).run();
    const send = db.raw.prepare(`INSERT INTO messages_log
      (id, friend_id, direction, message_type, content, template_id_at_send, created_at)
      VALUES (?, 'fr-1', 'outgoing', 'text', 'sent', ?, ?)`);
    send.run('lg-1', 'tp-04', '2026-09-01T00:00:00Z');
    send.run('lg-2', 'tp-04', '2026-09-02T00:00:00Z');
    send.run('lg-3', 'tp-01', '2026-09-01T00:00:00Z');
    const data = ((await (await get('message_type=text&quick=frequent&page=1&limit=5')).json()) as Body).data;
    // 実績 2 > 1 > 0 の順。実績なし同士は新しい順。
    expect(data.items.map((t) => t.id)).toEqual(['tp-04', 'tp-01', 'tp-03', 'tp-02']);
  });

  it('folder_counts=1 でフォルダ別件数が添えて返る', async () => {
    const data = ((await (await get('message_type=text&folder_counts=1&page=1&limit=2')).json()) as Body).data;
    expect(data.folderCounts).toEqual({ f1: 1, f2: 2, '': 1 });
  });

  it('別アカウントのテンプレートは候補にも件数にも出ない', async () => {
    const data = ((await (await get('message_type=text&page=1&limit=50&folder_counts=1')).json()) as Body).data;
    expect(data.total).toBe(4);
    expect(data.items.every((t) => t.id !== 'tp-x')).toBe(true);
    // 別アカウントの未分類1件は '' の件数に入らない。
    expect(data.folderCounts?.['']).toBe(1);
  });
});
