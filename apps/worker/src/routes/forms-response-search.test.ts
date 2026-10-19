import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

// N-171/N-179: 回答一覧APIが検索条件を受け取り、ページング前にサーバー側で絞り込む。
// 実 route＋実SQLiteで確かめる。件数・一覧・CSV（ページ巡回）が同じ条件になる。

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: async () => ({
    allowedAccountIds: ['acc-1', 'acc-2'],
    canSeeUnassigned: true,
  }),
  canAccessAllLineAccounts: async () => true,
}));

const { forms } = await import('./forms.js');

function setupApp(testDb: SqliteD1) {
  const app = new Hono<{
    Bindings: { DB: D1Database };
    Variables: { staff: AuthenticatedStaff };
  }>();
  app.use('*', async (c, next) => {
    c.env = { DB: testDb.db } as never;
    c.set('staff', {
      id: 'staff-1',
      name: 'Staff',
      role: 'owner',
      readOnly: false,
      permissionKeys: [],
      assignedLineAccountId: null,
      canAccessDescendantAccounts: false,
      tenantId: 'tenant-1',
    });
    await next();
  });
  app.route('/', forms);
  return app;
}

function seed(testDb: SqliteD1) {
  const raw = testDb.raw;
  raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc-1', 'ch-1', '本店', 'tok-1', 'sec-1')`).run();
  raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc-2', 'ch-2', '支店', 'tok-2', 'sec-2')`).run();
  raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
    VALUES ('friend-1', 'U1', 'acc-1', '山田太郎', 1)`).run();
  raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
    VALUES ('friend-2', 'U2', 'acc-1', '佐藤花子', 1)`).run();
  raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
    VALUES ('friend-3', 'U3', 'acc-2', '山田次郎', 1)`).run();
  raw.prepare(`INSERT INTO forms (id, name, fields) VALUES ('form-1', 'アンケート', '[]')`).run();
  raw.prepare(`INSERT INTO forms (id, name, fields) VALUES ('form-2', '別フォーム', '[]')`).run();
  raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'acc-1')`).run();
  raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-2', 'acc-1')`).run();
  // 25件（limit=10 で3ページ）。一致行は3ページ目に置く。
  for (let index = 0; index < 25; index++) {
    const day = String(index + 1).padStart(2, '0');
    const data = index === 24
      ? JSON.stringify({ q1: '駐車場の案内がほしい' })
      : JSON.stringify({ q1: `ふつうの回答${index}` });
    raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
      VALUES (?, 'form-1', 'friend-2', ?, ?)`)
      .run(`sub-${day}`, data, `2026-08-${day} 10:00:00`);
  }
  // 特殊文字を含む行（% を文字どおりに探せるか）。
  raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
    VALUES ('sub-spec', 'form-1', 'friend-2', ?, '2026-09-01 10:00:00')`)
    .run(JSON.stringify({ q1: '満足度100%でした' }));
  // 別フォームの一致行（出てはいけない）。
  raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
    VALUES ('sub-other-form', 'form-2', 'friend-2', ?, '2026-09-02 10:00:00')`)
    .run(JSON.stringify({ q1: '駐車場の案内がほしい' }));
  // 別アカウントの友だちの一致行（account_id=acc-1 では出てはいけない）。
  raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
    VALUES ('sub-other-account', 'form-1', 'friend-3', ?, '2026-09-03 10:00:00')`)
    .run(JSON.stringify({ q1: '駐車場の案内がほしい' }));
}

function list(app: ReturnType<typeof setupApp>, params: string) {
  return app.request(`/api/forms/form-1/submissions?account_id=acc-1&${params}`);
}

describe('N-171/N-179 回答のサーバー側検索', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test('別ページの一致行が検索結果に出て、件数も一致する', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=10&q=' + encodeURIComponent('駐車場'));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(1);
    expect(body.data.items.map((item) => item.id)).toEqual(['sub-25']);
  });

  test('一致なしは0件', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=10&q=' + encodeURIComponent('存在しない語'));
    const body = await res.json() as { success: boolean; data: { items: unknown[]; total: number } };
    expect(body.data.total).toBe(0);
    expect(body.data.items).toEqual([]);
  });

  test('特殊文字%は文字どおりに探し、何にでも一致しない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=50&q=' + encodeURIComponent('100%'));
    const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
    expect(body.data.total).toBe(1);
    expect(body.data.items.map((item) => item.id)).toEqual(['sub-spec']);
  });

  test('別フォーム・別アカウントの一致行は出ない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=50&q=' + encodeURIComponent('駐車場'));
    const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
    expect(body.data.items.map((item) => item.id)).not.toContain('sub-other-form');
    expect(body.data.items.map((item) => item.id)).not.toContain('sub-other-account');
  });

  test('名前でも探せる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=50&q=' + encodeURIComponent('山田太郎'));
    const body = await res.json() as { success: boolean; data: { total: number } };
    expect(body.data.total).toBe(0);
    const res2 = await list(app, 'page=1&limit=50&q=' + encodeURIComponent('佐藤'));
    const body2 = await res2.json() as { success: boolean; data: { total: number } };
    expect(body2.data.total).toBe(26);
  });

  test('未検索は従来どおり全件ページング', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    const res = await list(app, 'page=1&limit=10');
    const body = await res.json() as { success: boolean; data: { items: unknown[]; total: number } };
    expect(body.data.total).toBe(26);
    expect(body.data.items).toHaveLength(10);
  });

  test('CSV巡回と同じ条件で全一致行が取れる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const app = setupApp(testDb);
    // 検索語に2件一致させる：sub-25（駐車場）と sub-spec（%）…ではなく、
    // 「回答」でふつう行25件に一致する条件をページ巡回する。
    const found: string[] = [];
    let page = 1;
    let total = 0;
    for (;;) {
      const res = await list(app, `page=${page}&limit=10&q=` + encodeURIComponent('ふつう'));
      const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
      total = body.data.total;
      found.push(...body.data.items.map((item) => item.id));
      if (found.length >= total || page > 100) break;
      page += 1;
    }
    expect(total).toBe(24);
    expect(found).toHaveLength(24);
  });
});

describe('回答一覧と集計の同じ期間',()=>{
  test('期間をページ分け前に適用し、集計・未完了数・開始数も同じ期間にする',async()=>{
    const db=createTestD1();seed(db);
    db.raw.exec("INSERT INTO form_opens(id,form_id,friend_id,opened_at) VALUES ('old','form-1','friend-1','2026-08-01 00:00:00'),('current','form-1','friend-2','2026-09-01 10:00:00');UPDATE form_submissions SET destination_write_status='failed' WHERE id='sub-spec'");
    const response=await list(setupApp(db),'page=1&limit=10&from=2026-09-01&to=2026-09-01');
    expect(response.status).toBe(200);const body=await response.json() as {data: import('@line-crm/shared').FormSubmissionPage};
    expect(body.data.items.map(r=>r.id)).toEqual(['sub-spec']);expect(body.data.total).toBe(1);
    expect(body.data.summary).toMatchObject({submitted:1,startedUnique:1,completionRate:100,destinationWrites:{failed:1}});
    db.raw.close();
  });
  test('終了日を含み、次の日は含まない。ISO日時と日本時間の旧日時を両方扱う',async()=>{
    const db=createTestD1();seed(db);
    for(const [id,at] of [['before','2026-08-31T14:59:59Z'],['start','2026-08-31T15:00:00Z'],['end','2026-09-01 23:59:59'],['after','2026-09-01T15:00:00Z']])db.raw.prepare("INSERT INTO form_submissions(id,form_id,friend_id,data,created_at) VALUES (?,'form-1','friend-1','{}',?)").run(id,at);
    const body=await (await list(setupApp(db),'page=1&limit=20&from=2026-09-01&to=2026-09-01')).json() as {data: import('@line-crm/shared').FormSubmissionPage};
    expect(body.data.items.map(r=>r.id).sort()).toEqual(['end','start','sub-spec']);expect(body.data.summary.submitted).toBe(3);
    const legacy=await (await list(setupApp(db),'from=2026-09-01&to=2026-09-01')).json() as {data: Array<{id:string}>};expect(legacy.data).toHaveLength(3);db.raw.close();
  });
  test.each(['from=2026-02-30','to=bad','from=2026-09-02&to=2026-09-01','period=invalid','period=this_month&from=2026-10-01'])('不正な期間は400: %s',async range=>{
    const db=createTestD1();seed(db);expect((await list(setupApp(db),`page=1&${range}`)).status).toBe(400);db.raw.close();
  });
  test('今月・先月・すべては日本時間の暦月を使う',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-08-31T15:00:00Z'));
    try {
      const db=createTestD1();seed(db);const app=setupApp(db);
      for(const [period,total] of [['this_month',1],['last_month',25],['all',26]]){
        const body=await (await list(app,`page=1&period=${period}`)).json() as {data: import('@line-crm/shared').FormSubmissionPage};expect(body.data.total).toBe(total);expect(body.data.summary.submitted).toBe(total);
      }
      db.raw.close();
    } finally {vi.useRealTimers()}
  });
});


test('期間を日付の回答人数と評価の平均にも適用する',async()=>{
  const db=createTestD1();seed(db);
  db.raw.prepare("UPDATE forms SET fields=? WHERE id='form-1'").run(JSON.stringify([{name:'visit',label:'来店日',type:'date'},{name:'rating',label:'評価',type:'rating'}]));
  db.raw.prepare("UPDATE form_submissions SET data=? WHERE id='sub-spec'").run(JSON.stringify({visit:'2026-09-01',rating:5}));
  db.raw.prepare("UPDATE form_submissions SET data=? WHERE id='sub-01'").run(JSON.stringify({visit:'2026-08-01',rating:1}));
  const body=await (await list(setupApp(db),'page=1&from=2026-09-01&to=2026-09-01')).json() as {data: import('@line-crm/shared').FormSubmissionPage};
  expect(body.data.summary).toMatchObject({dateAnsweredUniqueFriends:1,dateFields:[{key:'visit',answered:1,minDate:'2026-09-01',maxDate:'2026-09-01'}],ratingFields:[{key:'rating',answered:1,average:5}]});db.raw.close();
});
