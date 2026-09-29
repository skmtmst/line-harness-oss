import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { emptyLayout, newBlockId } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';

/**
 * P（回答フォームの公開前の試し・一覧の数・読みにくい色）の実DBテスト。
 *
 * 本物の bootstrap.sql（migration 482〜483 込み）を better-sqlite3 に流し、
 * 本物の @line-crm/db と本物の口で動かす。差し替えるのは本人確認だけ。
 * - 試し合言葉の発行・上限・期限切れの扱い
 * - 下書きを公開前に試せる（取得・開いた記録・回答・添付の入口）
 * - 試しは集計に入らず、後処理も動かない（件数・定員・1人1回・回答一覧・完了率）
 * - 今月の数は日本時間の1日から数え、完了率 ＝ 今月回答完了 ÷ 今月開いた人
 * - 読みにくい色（文字と背景が 4.5:1 未満）は保存・公開できない
 */

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineIdentity: vi.fn(async (auth: string | null) => {
    if (auth === 'Bearer test-friend-2') return { lineUserId: 'U-2', lineAccountId: 'account-a' };
    return { lineUserId: 'U-1', lineAccountId: 'account-a' };
  }),
}));

const { forms } = await import('./forms.js');

let sqlite: SqliteD1;

function env() {
  return { DB: sqlite.db } as unknown as Env['Bindings'];
}

function app(admin: boolean) {
  const instance = new Hono<Env>();
  if (admin) {
    instance.use('*', async (c, next) => {
      c.set('staff', { id: 'owner-1', role: 'owner', name: '店長' } as never);
      return next();
    });
  }
  instance.route('/', forms);
  return instance;
}

const KEY_1 = '11111111-2222-4333-8444-555555555555';
const KEY_2 = '22222222-3333-4444-8555-666666666666';
const KEY_3 = '33333333-4444-4555-8666-777777777777';

function adminRequest(path: string, method: 'PUT' | 'POST', body: Record<string, unknown>) {
  return app(true).request(
    `${path}?account_id=account-a`,
    { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env(),
  );
}

function publicSubmit(
  formId: string,
  body: Record<string, unknown>,
  key: string,
  auth = 'Bearer test-friend-1',
  extraHeaders: Record<string, string> = {},
) {
  return app(false).request(
    `/api/forms/${formId}/submit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth, 'Idempotency-Key': key, ...extraHeaders },
      body: JSON.stringify(body),
    },
    env(),
  );
}

/** 日本時間の今月（YYYY-MM）と先月。DBの時刻はJST文字列なので頭7文字で切る。 */
function monthPrefixes(): { current: string; previous: string } {
  const nowJst = new Date(Date.now() + 9 * 3600_000);
  const year = nowJst.getUTCFullYear();
  const month = nowJst.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const current = `${year}-${pad(month + 1)}`;
  const previous = month === 0 ? `${year - 1}-12` : `${year}-${pad(month)}`;
  return { current, previous };
}

/** 試しに使う下書き（未公開・受付停止）を作ってレイアウトを入れる。 */
async function makeDraftWithLayout(layout: Record<string, unknown>): Promise<string> {
  const created = await app(true).request(
    '/api/forms/drafts?account_id=account-a',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '試すフォーム', accountId: 'account-a' }) },
    env(),
  );
  expect(created.status).toBe(201);
  const createdBody = await created.json() as { data: { id: string } };
  const formId = createdBody.data.id;
  const saved = await adminRequest(`/api/forms/${formId}`, 'PUT', {
    layout,
    expectedContentRevision: 1,
  });
  expect(saved.status).toBe(200);
  return formId;
}

function textLayout(): Record<string, unknown> {
  const layout = emptyLayout() as unknown as Record<string, unknown>;
  const sections = layout.sections as Array<{ blocks: unknown[] }>;
  sections[0].blocks.push({
    id: newBlockId('b'),
    kind: 'input',
    type: 'text',
    name: 'full_name',
    label: 'お名前',
    required: true,
  });
  return layout;
}

async function issueToken(formId: string): Promise<{ token: string; expiresAt: string }> {
  const res = await adminRequest(`/api/forms/${formId}/test-token`, 'POST', {});
  expect(res.status).toBe(200);
  const body = await res.json() as { data: { token: string; expiresAt: string } };
  expect(body.data.token.length).toBeGreaterThan(30);
  return body.data;
}

beforeEach(() => {
  sqlite = createTestD1();
  sqlite.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-a', 'channel-a', '本店', 'token', 'secret')`,
  ).run();
  sqlite.raw.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, display_name)
     VALUES ('friend-1', 'U-1', 'account-a', '一郎'),
            ('friend-2', 'U-2', 'account-a', '二郎')`,
  ).run();
});

describe('試し合言葉の発行', () => {
  test('運用者以外は取れず、別アカウントでは見つからない', async () => {
    const formId = await makeDraftWithLayout(textLayout());
    const anonymous = await app(false).request(
      `/api/forms/${formId}/test-token?account_id=account-a`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      env(),
    );
    expect(anonymous.status).toBe(403);
    const wrongAccount = await app(true).request(
      `/api/forms/${formId}/test-token?account_id=account-b`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      env(),
    );
    expect(wrongAccount.status).toBe(404);
    // 生の合言葉は台帳に残さない（SHA-256 の16進だけ）。
    const { token } = await issueToken(formId);
    const stored = sqlite.raw.prepare(
      `SELECT token_hash FROM form_test_tokens WHERE form_id = ?`,
    ).get(formId) as { token_hash: string };
    expect(stored.token_hash).not.toContain(token);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('6件目は上限で断る', async () => {
    const formId = await makeDraftWithLayout(textLayout());
    for (let i = 0; i < 5; i += 1) {
      await issueToken(formId);
    }
    const sixth = await adminRequest(`/api/forms/${formId}/test-token`, 'POST', {});
    expect(sixth.status).toBe(429);
  });
});

describe('公開前の試し', () => {
  test('未公開の下書きを取得・開く・答える。違う合言葉は403', async () => {
    const formId = await makeDraftWithLayout(textLayout());
    // 合言葉なしでは未公開の下書きは見えない。
    const hidden = await app(false).request(`/api/forms/${formId}`, {}, env());
    expect(hidden.status).toBe(404);
    // 違う合言葉は本物として扱わない。
    const wrong = await app(false).request(`/api/forms/${formId}?test_token=wrong`, {}, env());
    expect(wrong.status).toBe(403);
    const { token } = await issueToken(formId);
    const shown = await app(false).request(
      `/api/forms/${formId}?test_token=${encodeURIComponent(token)}`, {}, env(),
    );
    expect(shown.status).toBe(200);
    await expect(shown.json()).resolves.toMatchObject({
      data: { id: formId, isTest: true },
    });
    const opened = await app(false).request(
      `/api/forms/${formId}/opened?test_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer test-friend-1' },
        body: JSON.stringify({}),
      },
      env(),
    );
    expect(opened.status).toBe(200);
    const submit = await publicSubmit(
      formId,
      { data: { full_name: '試しの一郎' }, testToken: token },
      KEY_1,
    );
    expect(submit.status).toBe(201);
    await expect(submit.json()).resolves.toMatchObject({
      data: { isTest: true },
    });
    // 試しの行が残り、本物の受付数は動かない。
    const row = sqlite.raw.prepare(
      `SELECT is_test, destination_write_status FROM form_submissions WHERE form_id = ?`,
    ).get(formId) as { is_test: number; destination_write_status: string };
    expect(row.is_test).toBe(1);
    // 後処理が動いていない（書き込み結果の記録が pending のまま）。
    expect(row.destination_write_status).toBe('pending');
    const count = sqlite.raw.prepare(
      `SELECT submit_count FROM forms WHERE id = ?`,
    ).get(formId) as { submit_count: number };
    expect(count.submit_count).toBe(0);
    const opens = sqlite.raw.prepare(
      `SELECT is_test FROM form_opens WHERE form_id = ?`,
    ).get(formId) as { is_test: number };
    expect(opens.is_test).toBe(1);
  });

  test('必須が空の試しは止め、試しは1人1回・上限・定員に縛られない', async () => {
    const layout = textLayout() as unknown as {
      sections: Array<{ blocks: unknown[] }>;
      options: Record<string, unknown>;
    };
    layout.options.oncePerFriend = { enabled: true };
    layout.options.totalLimit = { enabled: true, max: 1 };
    const formId = await makeDraftWithLayout(layout as unknown as Record<string, unknown>);
    const { token } = await issueToken(formId);
    // 必須が空なら試しでも止まる（入力の形は本物と同じに見る）。
    const empty = await publicSubmit(formId, { data: {}, testToken: token }, KEY_1);
    expect(empty.status).toBe(400);
    // 試しは何度でも通る。
    const first = await publicSubmit(formId, { data: { full_name: '試し1' }, testToken: token }, KEY_1);
    expect(first.status).toBe(201);
    const second = await publicSubmit(formId, { data: { full_name: '試し2' }, testToken: token }, KEY_2);
    expect(second.status).toBe(201);
    // 定員・件数の確保が動いていない。
    const claims = sqlite.raw.prepare(
      `SELECT COUNT(*) AS n FROM form_capacity_claims WHERE form_id = ?`,
    ).get(formId) as { n: number };
    expect(claims.n).toBe(0);
  });

  test('試しは本物の回答・集計を汚さない', async () => {
    const layout = textLayout() as unknown as {
      sections: Array<{ blocks: unknown[] }>;
      options: Record<string, unknown>;
    };
    layout.options.oncePerFriend = { enabled: true };
    const formId = await makeDraftWithLayout(layout as unknown as Record<string, unknown>);
    const { token } = await issueToken(formId);
    // 先に試す。
    const trial = await publicSubmit(formId, { data: { full_name: '試し' }, testToken: token }, KEY_1);
    expect(trial.status).toBe(201);
    // 公開して受付を始める。
    const published = await adminRequest(`/api/forms/${formId}/publish`, 'POST', {
      expectedContentRevision: 2,
    });
    expect(published.status).toBe(200);
    const activated = await adminRequest(`/api/forms/${formId}`, 'PUT', {
      isActive: true,
      expectedContentRevision: 2,
    });
    expect(activated.status).toBe(200);
    // 試しがあっても本物の1人1回は空いている。
    // 202 は後処理の未完（回答の保存は済んでいる）。保存の成否だけ見る。
    const real = await publicSubmit(formId, { data: { full_name: '本物の一郎' } }, KEY_2);
    expect([201, 202]).toContain(real.status);
    // 同じ人の2回目は本物同士で止まる。
    const again = await publicSubmit(formId, { data: { full_name: '二度目' } }, KEY_3);
    expect(again.status).toBe(400);
    // 回答一覧と受付数に試しは出ない。
    const list = await app(true).request(
      `/api/forms/${formId}/submissions?page=1&limit=20&account_id=account-a`, {}, env(),
    );
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: { total: number; items: Array<{ data: { full_name: string } }> } };
    expect(listBody.data.total).toBe(1);
    const detail = await app(true).request(
      `/api/forms/${formId}?account_id=account-a`, {}, env(),
    );
    const detailBody = await detail.json() as { data: { submitCount: number } };
    expect(detailBody.data.submitCount).toBe(1);
  });
});

describe('一覧の今月の数', () => {
  test('日本時間の1日から数え、完了率 ＝ 今月回答完了 ÷ 今月開いた人。試しと先月は入れない', async () => {
    const formId = await makeDraftWithLayout(textLayout());
    const { token } = await issueToken(formId);
    const { current, previous } = monthPrefixes();
    // 今月：本物の回答1（friend-1）・開いた人2（friend-1・friend-2）。
    await publicSubmit(formId, { data: { full_name: '試し' }, testToken: token }, KEY_1);
    await app(false).request(
      `/api/forms/${formId}/opened?test_token=${encodeURIComponent(token)}`,
      { method: 'POST', headers: { Authorization: 'Bearer test-friend-1' }, body: '{}' },
      env(),
    );
    sqlite.raw.prepare(
      `INSERT INTO form_submissions (id, form_id, friend_id, data, destination_write_status, created_at)
       VALUES ('real-now', ?, 'friend-1', '{}', 'succeeded', ?)`,
    ).run(formId, `${current}-15T12:00:00.000+09:00`);
    for (const friend of ['friend-1', 'friend-2']) {
      sqlite.raw.prepare(
        `INSERT INTO form_opens (id, form_id, friend_id, opened_at)
         VALUES (?, ?, ?, ?)`,
      ).run(`open-now-${friend}`, formId, friend, `${current}-15T12:00:00.000+09:00`);
    }
    // 先月：本物の回答1・開いた人1（数えない）。
    sqlite.raw.prepare(
      `INSERT INTO form_submissions (id, form_id, friend_id, data, destination_write_status, created_at)
       VALUES ('real-prev', ?, 'friend-1', '{}', 'succeeded', ?)`,
    ).run(formId, `${previous}-15T12:00:00.000+09:00`);
    sqlite.raw.prepare(
      `INSERT INTO form_opens (id, form_id, friend_id, opened_at)
       VALUES ('open-prev', ?, 'friend-1', ?)`,
    ).run(formId, `${previous}-15T12:00:00.000+09:00`);
    const res = await app(true).request('/api/forms?account_id=account-a', {}, env());
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{ id: string; monthlySubmitCount: number; monthlyOpenCount: number; monthlyCompletionRate: number | null }>;
    };
    const item = body.data.find((row) => row.id === formId);
    expect(item?.monthlySubmitCount).toBe(1);
    expect(item?.monthlyOpenCount).toBe(2);
    expect(item?.monthlyCompletionRate).toBe(50);
  });

  test('開いた人がいなければ完了率は「—」（null）。0%とは言わない', async () => {
    const formId = await makeDraftWithLayout(textLayout());
    const { current } = monthPrefixes();
    sqlite.raw.prepare(
      `INSERT INTO form_submissions (id, form_id, friend_id, data, destination_write_status, created_at)
       VALUES ('real-only', ?, 'friend-1', '{}', 'succeeded', ?)`,
    ).run(formId, `${current}-15T12:00:00.000+09:00`);
    const res = await app(true).request('/api/forms?account_id=account-a', {}, env());
    const body = await res.json() as {
      data: Array<{ id: string; monthlySubmitCount: number; monthlyOpenCount: number; monthlyCompletionRate: number | null }>;
    };
    const item = body.data.find((row) => row.id === formId);
    expect(item?.monthlySubmitCount).toBe(1);
    expect(item?.monthlyOpenCount).toBe(0);
    expect(item?.monthlyCompletionRate).toBeNull();
  });
});

describe('読みにくい色は保存・公開できない', () => {
  const lowContrastTheme = {
    main: '#008f3d',
    sub: '#ffffff',
    accent: '#175cd3',
    error: '#e5484d',
    text: '#999999',
    fontFamily: 'sans',
    cornerRadius: 'medium',
    backgroundImageUrl: null,
  };

  test('下書き保存で422、公開前の検査で400', async () => {
    const formId = await makeDraftWithLayout(textLayout());
    const layout = textLayout() as unknown as {
      sections: Array<{ blocks: unknown[] }>;
      options: Record<string, unknown>;
    };
    layout.options.theme = lowContrastTheme;
    const save = await adminRequest(`/api/forms/${formId}`, 'PUT', {
      layout,
      expectedContentRevision: 2,
    });
    expect(save.status).toBe(422);
    await expect(save.json()).resolves.toMatchObject({
      error: expect.stringContaining('保存できません'),
    });
    // すり抜けた古い色は公開で止まる。
    sqlite.raw.prepare(`UPDATE forms SET layout = ? WHERE id = ?`).run(
      JSON.stringify(layout),
      formId,
    );
    const published = await adminRequest(`/api/forms/${formId}/publish`, 'POST', {
      expectedContentRevision: 2,
    });
    expect(published.status).toBe(400);
    await expect(published.json()).resolves.toMatchObject({
      error: expect.stringContaining('保存できません'),
    });
  });
});
