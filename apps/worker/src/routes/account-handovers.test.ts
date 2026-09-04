import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * LINEアカウントの乗り換え（引き継ぎ）。設計 ★V6 33-4（`nx3XW`）。台帳 #133。
 *
 * ここで守りたいのは 3 点。
 *   **合計が合わない数を通さない**（合わないと、どこかの人が消えたように見える）
 *   **分からないプロバイダーを「同じ」と言わない**
 *   **決めていない人がいるまま本実行させない**（その人がどちらにも入らず消える）
 */

const db = {
  compareProviders: vi.fn(),
  countsAddUp: vi.fn(),
  MATCH_BUCKETS: ['auto', 'review', 'unmatched', 'lookalike'] as const,
  issueHandoverCode: vi.fn(),
  getHandoverById: vi.fn(),
  linkHandover: vi.fn(),
  savePreview: vi.fn(),
  saveDecision: vi.fn(),
  listDecisions: vi.fn(),
  listHandoversForAccount: vi.fn(),
  unresolvedReviewCount: vi.fn(),
  markResolved: vi.fn(),
  markExecuting: vi.fn(),
  completeHandover: vi.fn(),
  cancelHandover: vi.fn(),
};
vi.mock('@line-crm/db', () => db);

const accountAccess = { canAccessAllLineAccounts: vi.fn(), getVisibleLineAccountScope: vi.fn() };
vi.mock('../services/account-access.js', () => accountAccess);

const { accountHandovers } = await import('./account-handovers.js');

const run = vi.fn();
const bind = vi.fn(() => ({ run, first: vi.fn(), all: vi.fn(async () => ({ results: [] })) }));
const prepare = vi.fn(() => ({ bind }));
const env = { DB: { prepare } as unknown as D1Database };

function makeApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', accountHandovers);
  return app;
}

function post(path: string, body: unknown) {
  return new Request(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function put(path: string, body: unknown) {
  return new Request(`https://example.com${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const HANDOVER = {
  id: 'ho-1',
  from_account_id: 'acc-from',
  to_account_id: 'acc-to',
  code: 'ABCD-EFGH-JKMN',
  code_expires_at: '2099-01-01T00:00:00+09:00',
  status: 'linked' as const,
  provider_match: 'same' as const,
  source_friend_total: null,
  auto_count: null,
  review_count: null,
  unmatched_count: null,
  lookalike_count: null,
  moved_count: 0,
  failed_count: 0,
  failure_reason: null,
  created_by: 'u-1',
  created_at: '2026-09-04T00:00:00+09:00',
  linked_at: '2026-09-04T00:01:00+09:00',
  previewed_at: null,
  resolved_at: null,
  executed_at: null,
  completed_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  db.getHandoverById.mockResolvedValue(HANDOVER);
  db.listDecisions.mockResolvedValue([]);
  db.unresolvedReviewCount.mockResolvedValue(0);
  db.savePreview.mockResolvedValue({ ok: true });
  db.countsAddUp.mockImplementation(
    (counts: Record<string, number>, total: number) =>
      counts.auto + counts.review + counts.unmatched + counts.lookalike === total,
  );
});

describe('段3 事前確認', () => {
  /*
    **合計が合わない結果を通さない。** 通すと画面がそれを出し、
    運用者は「どこかの人が消えた」と読む。
  */
  it('4区分の合計が元の友だち数と合わなければ 422 で断る', async () => {
    const res = await makeApp().fetch(
      post('/api/account-handovers/ho-1/preview', {
        sourceFriendTotal: 100,
        counts: { auto: 60, review: 20, unmatched: 10, lookalike: 5 },
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: '区分の合計が元の友だち数と合いません' });
    expect(db.savePreview).not.toHaveBeenCalled();
  });

  it('合っていれば保存する', async () => {
    const res = await makeApp().fetch(
      post('/api/account-handovers/ho-1/preview', {
        sourceFriendTotal: 100,
        counts: { auto: 60, review: 20, unmatched: 15, lookalike: 5 },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(db.savePreview).toHaveBeenCalledWith(expect.anything(), 'ho-1', {
      sourceFriendTotal: 100,
      counts: { auto: 60, review: 20, unmatched: 15, lookalike: 5 },
    });
  });

  it('区分が1つでも欠けていたら断る（0 で埋めない）', async () => {
    const res = await makeApp().fetch(
      post('/api/account-handovers/ho-1/preview', {
        sourceFriendTotal: 100,
        counts: { auto: 60, review: 20, unmatched: 20 },
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'lookalike の人数が要ります' });
  });

  /*
    **事前確認だけでは元のアカウントを変えない。**
    設計の「ここで止めても、元のアカウントは何も変わりません」。
  */
  it('friends を書き換えない', async () => {
    await makeApp().fetch(
      post('/api/account-handovers/ho-1/preview', {
        sourceFriendTotal: 10,
        counts: { auto: 10, review: 0, unmatched: 0, lookalike: 0 },
      }),
      env,
    );
    const statements = prepare.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => /UPDATE\s+friends/i.test(sql))).toBe(false);
  });

  it('受け取り先が決まっていなければ断る', async () => {
    db.getHandoverById.mockResolvedValue({ ...HANDOVER, to_account_id: null });
    const res = await makeApp().fetch(
      post('/api/account-handovers/ho-1/preview', {
        sourceFriendTotal: 1,
        counts: { auto: 1, review: 0, unmatched: 0, lookalike: 0 },
      }),
      env,
    );
    expect(res.status).toBe(422);
  });
});

describe('数はまとめて出すか、出さないか', () => {
  it('事前確認の前は counts を null で返す', async () => {
    const res = await makeApp().fetch(
      new Request('https://example.com/api/account-handovers/ho-1'),
      env,
    );
    expect(await res.json()).toMatchObject({ data: { counts: null } });
  });

  it('事前確認のあとは4区分と合計をそろえて返す', async () => {
    db.getHandoverById.mockResolvedValue({
      ...HANDOVER,
      source_friend_total: 100,
      auto_count: 60,
      review_count: 20,
      unmatched_count: 15,
      lookalike_count: 5,
    });
    const res = await makeApp().fetch(
      new Request('https://example.com/api/account-handovers/ho-1'),
      env,
    );
    expect(await res.json()).toMatchObject({
      data: { counts: { sourceTotal: 100, auto: 60, review: 20, unmatched: 15, lookalike: 5 } },
    });
  });
});

describe('段4 競合の判断', () => {
  /*
    **「同じ人として結びつける」のに相手がいない、を通さない。**
    通すと本実行で行き先の無い人ができ、静かに消える。
  */
  it('link なのに相手が無ければ 422 で断る', async () => {
    const res = await makeApp().fetch(
      put('/api/account-handovers/ho-1/decisions', {
        decisions: [{ fromFriendId: 'f-1', decision: 'link', bucket: 'review' }],
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: '結びつける相手が要ります' });
    expect(db.saveDecision).not.toHaveBeenCalled();
  });

  it('skip は相手がいなくてよい', async () => {
    const res = await makeApp().fetch(
      put('/api/account-handovers/ho-1/decisions', {
        decisions: [{ fromFriendId: 'f-1', decision: 'skip', bucket: 'unmatched' }],
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(db.saveDecision).toHaveBeenCalledTimes(1);
  });

  it('知らない区分を受け取らない', async () => {
    const res = await makeApp().fetch(
      put('/api/account-handovers/ho-1/decisions', {
        decisions: [{ fromFriendId: 'f-1', decision: 'skip', bucket: 'maybe' }],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('要確認が全部決まったら段4を終わりにする', async () => {
    db.unresolvedReviewCount.mockResolvedValue(0);
    await makeApp().fetch(
      put('/api/account-handovers/ho-1/decisions', {
        decisions: [{ fromFriendId: 'f-1', decision: 'new', bucket: 'review' }],
      }),
      env,
    );
    expect(db.markResolved).toHaveBeenCalledWith(expect.anything(), 'ho-1');
  });

  it('のこりがあるうちは段4を終わりにしない', async () => {
    db.unresolvedReviewCount.mockResolvedValue(3);
    await makeApp().fetch(
      put('/api/account-handovers/ho-1/decisions', {
        decisions: [{ fromFriendId: 'f-1', decision: 'new', bucket: 'review' }],
      }),
      env,
    );
    expect(db.markResolved).not.toHaveBeenCalled();
  });
});

describe('段5 本実行', () => {
  /*
    **決めていない人がいるまま実行させない。**
    その人はどちらにも入らず、静かに消える。
  */
  it('要確認がのこっていたら 422 で止め、件数を言う', async () => {
    db.getHandoverById.mockResolvedValue({ ...HANDOVER, source_friend_total: 100, review_count: 5 });
    db.unresolvedReviewCount.mockResolvedValue(3);
    const res = await makeApp().fetch(post('/api/account-handovers/ho-1/execute', {}), env);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: '要確認が3件のこっています。全部決めてから実行してください',
    });
    expect(db.markExecuting).not.toHaveBeenCalled();
  });

  it('事前確認をしていなければ止める', async () => {
    db.getHandoverById.mockResolvedValue({ ...HANDOVER, source_friend_total: null });
    const res = await makeApp().fetch(post('/api/account-handovers/ho-1/execute', {}), env);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: '先に事前確認をしてください' });
  });

  it('もう実行したものは二重に実行しない', async () => {
    db.getHandoverById.mockResolvedValue({
      ...HANDOVER,
      status: 'completed',
      source_friend_total: 10,
    });
    const res = await makeApp().fetch(post('/api/account-handovers/ho-1/execute', {}), env);
    expect(res.status).toBe(409);
  });

  /*
    照合。**動かした数と、動かすつもりだった数を突き合わせる。**
    数だけ返して「終わりました」と言わない。
  */
  it('動かした数と予定数を突き合わせて返す', async () => {
    db.getHandoverById.mockResolvedValue({ ...HANDOVER, source_friend_total: 3, review_count: 0 });
    db.listDecisions.mockResolvedValue([
      { from_friend_id: 'f-1', decision: 'link', to_friend_id: 't-1' },
      { from_friend_id: 'f-2', decision: 'new', to_friend_id: null },
      { from_friend_id: 'f-3', decision: 'skip', to_friend_id: null },
    ]);
    const res = await makeApp().fetch(post('/api/account-handovers/ho-1/execute', {}), env);
    expect(res.status).toBe(200);
    // skip は動かさない。予定は 2 件。
    expect(await res.json()).toMatchObject({ data: { plannedCount: 2 } });
    expect(db.completeHandover).toHaveBeenCalledWith(expect.anything(), 'ho-1', {
      movedCount: 2,
      failedCount: 0,
      failureReason: null,
    });
  });
});

describe('見える範囲', () => {
  it('片方のアカウントしか見えない人には出さない', async () => {
    accountAccess.canAccessAllLineAccounts.mockResolvedValue(false);
    const res = await makeApp().fetch(
      new Request('https://example.com/api/account-handovers/ho-1'),
      env,
    );
    expect(res.status).toBe(404);
  });
});
