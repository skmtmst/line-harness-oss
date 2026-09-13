/*
 * #666 N-004: 写真一覧の口を実D1（bootstrap.sql を流した SQLite）で固定する。
 *
 * ダッシュボードの「写真審査 確認待ち N件」は全件を数えるのに、深掘り先の
 * 一覧は 200 枚で打ち切られていた。201 枚目以降へ到達できないと、押した
 * 人から見て件数と中身が食い違う。ここで押さえる契約:
 *  1. 既定は 200 枚まで（今までどおり）
 *  2. offset で続きが取れ、1ページ目と重複も抜けもない
 *  3. 全ページを合わせると仕込んだ全件と一致する
 *  4. 同じ created_at が並んでも並びが安定する（id で決着が付く）
 *  5. limit/offset の壊れた指定は既定へ落とし、負の offset で例外にしない
 *
 * 数え上げは実SQLに当てる。手書きのDBモックだと LIMIT/OFFSET の意味も
 * 並び順も確かめられない。
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1 } from '../test-utils/d1-sqlite.js';

const accountAccess = vi.hoisted(() => ({ canAccessAllLineAccounts: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canAccessAllLineAccounts: accountAccess.canAccessAllLineAccounts,
}));

const { nenMembers } = await import('./nen-members.js');

const ACCOUNT = 'account-a';
/** 200枚ちょうどでは「打ち切り」と「ぴったり」の区別が付かないので余分に足す。 */
const TOTAL = 245;

let sql: Database.Database;
let db: D1Database;

function seed(raw: Database.Database): void {
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a'),
           ('account-b', 'channel-b', 'B店', 'token-b', 'secret-b');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('friend-a', 'U-a', 'Aさん', 'account-a', 1, '2026-01-01T00:00:00.000', '2026-01-01T00:00:00.000'),
           ('friend-b', 'U-b', 'Bさん', 'account-b', 1, '2026-01-01T00:00:00.000', '2026-01-01T00:00:00.000');
    INSERT INTO nen_pet_profiles (id, friend_id, name, created_at, updated_at)
    VALUES ('pet-a', 'friend-a', 'ハナ', '2026-01-01', '2026-01-01'),
           ('pet-b', 'friend-b', 'ソラ', '2026-01-01', '2026-01-01');
  `);
  const insert = raw.prepare(
    `INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, content_type, status, created_at,
       updated_at, line_account_id, review_image_url, review_version)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 'pending', ?, ?, ?, ?, 1)`,
  );
  for (let index = 0; index < TOTAL; index += 1) {
    const id = `photo-${String(index).padStart(3, '0')}`;
    /*
     * 3枚ずつ同じ created_at にする。並びが created_at だけだと、この
     * かたまりの中の順番が呼ぶたびに変わり、ページの境目で重複や抜けが出る。
     */
    const createdAt = `2026-01-${String(1 + Math.floor(index / 3)).padStart(2, '0')}T00:00:00.000`;
    insert.run(id, 'friend-a', 'pet-a', `k/${id}`, `legacy-${id}`, createdAt, createdAt, ACCOUNT, `https://cdn.test/${id}.jpg`);
  }
  // 別アカウントの写真。ページングで混ざってはいけない。
  insert.run('photo-other', 'friend-b', 'pet-b', 'k/other', 'legacy-other',
    '2026-12-31T00:00:00.000', '2026-12-31T00:00:00.000', 'account-b', 'https://cdn.test/other.jpg');
}

function harness(database: D1Database) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-a', name: '担当者', role: 'staff', readOnly: false,
      permissionKeys: ['photo.submission.view'],
    });
    c.env = { DB: database };
    await next();
  });
  app.route('/', nenMembers);
  return app;
}

async function page(query: string): Promise<Array<Record<string, unknown>>> {
  const response = await harness(db).request(
    new Request(`https://worker.test/api/nen-members/photos?accountId=${ACCOUNT}${query}`),
  );
  expect(response.status).toBe(200);
  const body = await response.json() as { success: boolean; data: Array<Record<string, unknown>> };
  expect(body.success).toBe(true);
  return body.data;
}

beforeEach(() => {
  const created = createTestD1();
  sql = created.raw;
  db = created.db;
  seed(sql);
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
});

describe('写真一覧のページング(#666 N-004)', () => {
  it('既定は200枚まで返す', async () => {
    const first = await page('');
    expect(first).toHaveLength(200);
  });

  it('offsetで続きが取れ、全ページを合わせると仕込んだ全件になる', async () => {
    const first = await page('');
    const second = await page(`&offset=${first.length}`);
    // 201枚目以降が実際に返ること。ここが空だと深掘り先から到達できない。
    expect(second.length).toBe(TOTAL - 200);
    const ids = [...first, ...second].map((row) => String(row.id));
    expect(new Set(ids).size).toBe(TOTAL);
    const seeded = sql.prepare(
      `SELECT id FROM nen_photo_submissions WHERE line_account_id = ? ORDER BY id`,
    ).all(ACCOUNT).map((row) => String((row as { id: string }).id));
    expect([...ids].sort()).toEqual(seeded);
    // 別アカウントの写真は1枚も混ざらない。
    expect(ids).not.toContain('photo-other');
  });

  it('小さいlimitで刻んでも重複せず、全件をちょうど1回ずつ返す', async () => {
    const collected: string[] = [];
    for (let offset = 0; offset < TOTAL + 10; offset += 25) {
      const rows = await page(`&limit=25&offset=${offset}`);
      collected.push(...rows.map((row) => String(row.id)));
      if (rows.length < 25) break;
    }
    expect(collected).toHaveLength(TOTAL);
    expect(new Set(collected).size).toBe(TOTAL);
  });

  it('created_atが同じ写真の中の順番は id で決まる（並びが呼ぶたびに変わらない）', async () => {
    /*
     * 仕込みは3枚ずつ同じ created_at。新しい順に見ると、いちばん新しい
     * かたまりは photo-243/244、その次が photo-240〜242。かたまりの中は
     * id の大きい順。決着を付けないと SQLite の読み出し順に左右され、
     * ページの境目で同じ写真が二度出たり抜けたりする。
     */
    const head = await page('&limit=5');
    expect(head.map((row) => row.id)).toEqual([
      'photo-244', 'photo-243', 'photo-242', 'photo-241', 'photo-240',
    ]);
  });

  it('ページを分けても、通しで取ったときとまったく同じ並びになる', async () => {
    const whole = await page('&limit=30');
    const head = await page('&limit=10');
    const middle = await page('&limit=10&offset=10');
    const tail = await page('&limit=10&offset=20');
    expect([...head, ...middle, ...tail].map((row) => row.id)).toEqual(whole.map((row) => row.id));
  });

  it('limitは200で頭打ちにし、壊れた指定や負のoffsetは既定へ落とす', async () => {
    expect(await page('&limit=9999')).toHaveLength(200);
    expect(await page('&limit=abc')).toHaveLength(200);
    expect(await page('&limit=0')).toHaveLength(1);
    const negative = await page('&offset=-5');
    const beginning = await page('');
    expect(negative.map((row) => row.id)).toEqual(beginning.map((row) => row.id));
  });

  it('権限のないLINEアカウントには403を返し、ページングでも漏れない', async () => {
    accountAccess.canAccessAllLineAccounts.mockResolvedValue(false);
    const response = await harness(db).request(
      new Request(`https://worker.test/api/nen-members/photos?accountId=${ACCOUNT}&offset=200`),
    );
    expect(response.status).toBe(403);
  });
});
