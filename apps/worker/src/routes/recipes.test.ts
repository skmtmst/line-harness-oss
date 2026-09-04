import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * レシピ。設計 ★V6 34-2 / 34-3。台帳 #134。
 *
 * 守りたいのは 2 点。
 *   **部分的に作らない**（半分だけ残ると、何を消せばよいか分からない）
 *   **同じキーで2回作らない**（押し直しで下書きが二重にできる）
 */

const db = {
  listRecipes: vi.fn(),
  getRecipeById: vi.fn(),
  cloneCounts: vi.fn(),
  getCloneRun: vi.fn(),
  findRunByKey: vi.fn(),
  startCloneRun: vi.fn(),
  recordCloneItem: vi.fn(),
  listCloneItems: vi.fn(),
  finishCloneRun: vi.fn(),
  rollbackCloneRun: vi.fn(),
  getVersionedAccountSetting: vi.fn(),
  parseFeatures: (row: { required_features: string }) => JSON.parse(row.required_features),
  parseItems: (row: { items_json: string | null }) =>
    row.items_json ? JSON.parse(row.items_json) : null,
  missingFeatures: (required: string[], features: Record<string, boolean>) =>
    required.filter((k) => features[k] === false),
  prefixedName: (prefix: string | null | undefined, name: string) =>
    (prefix ?? '').trim() ? `${(prefix ?? '').trim()} ${name}` : name,
};
vi.mock('@line-crm/db', () => db);

const accountAccess = { canAccessAllLineAccounts: vi.fn(), getVisibleLineAccountScope: vi.fn() };
vi.mock('../services/account-access.js', () => accountAccess);

const { recipes } = await import('./recipes.js');

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
  app.route('/', recipes);
  return app;
}

const RECIPE = {
  id: 'rcp-1',
  name: '新規登録 7日間フォロー',
  purpose: '友だちが増えたあと、7日かけて関係を作ります。',
  creates_summary: 'タグ1つ、シナリオ7通',
  version: 1,
  origin: 'builtin' as const,
  required_features: JSON.stringify(['scenarios', 'templates']),
  items_json: JSON.stringify([
    { kind: 'タグ', name: '新規', note: '友だち追加時のルールから付きます' },
    { kind: 'テンプレート', name: '1通目 はじめまして', note: '本文は見本です' },
  ]),
  item_count: 16,
  display_order: 0,
  created_at: '2026-09-04T00:00:00+09:00',
  updated_at: '2026-09-04T00:00:00+09:00',
};

function clone(body: unknown, key: string | null = 'idem-1') {
  return new Request('https://example.com/api/recipes/rcp-1/clone', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  db.getRecipeById.mockResolvedValue(RECIPE);
  db.listRecipes.mockResolvedValue([RECIPE]);
  db.cloneCounts.mockResolvedValue({ 'rcp-1': 12 });
  db.findRunByKey.mockResolvedValue(null);
  db.startCloneRun.mockResolvedValue({ id: 'run-1' });
  db.listCloneItems.mockResolvedValue([]);
  db.getVersionedAccountSetting.mockResolvedValue({ data: { features: {} } });
  run.mockResolvedValue(undefined);
});

describe('一覧', () => {
  it('これまで何回作られたかを返す（0回と書かずに済むようになった）', async () => {
    const res = await makeApp().fetch(new Request('https://example.com/api/recipes'), env);
    expect(await res.json()).toMatchObject({ data: [{ cloneCount: 12 }] });
  });

  /*
    **機能設定に行が無い機能を「オフ」と読まない。** 友だち属性のように
    切れない機能は表に無い。無いことをオフと読むと、どのレシピも使えなくなる。
  */
  it('保存が無い組織で、全部オフだと言わない', async () => {
    db.getVersionedAccountSetting.mockResolvedValue(null);
    const res = await makeApp().fetch(
      new Request('https://example.com/api/recipes?account_id=acc-1'),
      env,
    );
    expect(await res.json()).toMatchObject({ data: [{ missingFeatures: [] }] });
  });

  it('明示的にオフの機能だけを足りないと数える', async () => {
    db.getVersionedAccountSetting.mockResolvedValue({ data: { features: { scenarios: false } } });
    const res = await makeApp().fetch(
      new Request('https://example.com/api/recipes?account_id=acc-1'),
      env,
    );
    expect(await res.json()).toMatchObject({ data: [{ missingFeatures: ['scenarios'] }] });
  });

  /* **決まっていない内訳を 0 件の表にしない。** */
  it('内訳が決まっていなければ items は null', async () => {
    db.listRecipes.mockResolvedValue([{ ...RECIPE, items_json: null }]);
    const res = await makeApp().fetch(new Request('https://example.com/api/recipes'), env);
    const body = await res.json() as { data: Array<{ items: unknown; itemCount: number }> };
    expect(body.data[0].items).toBeNull();
    // 件数だけは設計の1行から分かるので、そちらは出してよい。
    expect(body.data[0].itemCount).toBe(16);
  });
});

describe('複製', () => {
  it('冪等キーが無ければ断る', async () => {
    const res = await makeApp().fetch(clone({ accountId: 'acc-1' }, null), env);
    expect(res.status).toBe(400);
    expect(db.startCloneRun).not.toHaveBeenCalled();
  });

  /* **同じキーで2回作らない。** 押し直しや再送で下書きが二重にできる。 */
  it('同じキーで来たら前の結果を返し、作り直さない', async () => {
    db.findRunByKey.mockResolvedValue({ id: 'run-前', status: 'succeeded', created_count: 2 });
    const res = await makeApp().fetch(clone({ accountId: 'acc-1' }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { runId: 'run-前', createdCount: 2 } });
    expect(db.startCloneRun).not.toHaveBeenCalled();
  });

  /* **作ってから「使えません」と言わない。** 作る前に断る。 */
  it('機能がオフなら作る前に断る', async () => {
    db.getVersionedAccountSetting.mockResolvedValue({ data: { features: { scenarios: false } } });
    const res = await makeApp().fetch(clone({ accountId: 'acc-1' }), env);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ missingFeatures: ['scenarios'] });
    expect(db.startCloneRun).not.toHaveBeenCalled();
  });

  /* **何ができるか言えないものを作らない。** */
  it('内訳が決まっていないレシピは作れない', async () => {
    db.getRecipeById.mockResolvedValue({ ...RECIPE, items_json: null });
    const res = await makeApp().fetch(clone({ accountId: 'acc-1' }), env);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: '作られるものの内訳が、まだ決まっていません',
    });
  });

  it('あたまに付ける文字を名前に足す', async () => {
    await makeApp().fetch(clone({ accountId: 'acc-1', namePrefix: '2026春' }), env);
    const names = bind.mock.calls.flat().filter((v) => typeof v === 'string');
    expect(names.some((n) => String(n).startsWith('2026春 '))).toBe(true);
  });

  /*
    **部分的に作らない**（要件 §7-3）。半分だけできた状態は、
    運用者が何を消せばよいか分からない。
  */
  it('途中で失敗したら作ったものを全部戻す', async () => {
    run.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('D1 error'));
    const res = await makeApp().fetch(clone({ accountId: 'acc-1' }), env);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: '作れませんでした。何も作られていません' });
    expect(db.rollbackCloneRun).toHaveBeenCalledWith(expect.anything(), 'run-1');
    expect(db.finishCloneRun).toHaveBeenCalledWith(expect.anything(), 'run-1', {
      status: 'failed',
      createdCount: 0,
      failureReason: 'D1 error',
    });
  });

  it('全部できたら 202 と run ID を返す', async () => {
    const res = await makeApp().fetch(clone({ accountId: 'acc-1' }), env);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ data: { runId: 'run-1', status: 'succeeded', createdCount: 2 } });
  });

  /* **すべて下書きで作る。** 放っておいても友だちには何も届かない。 */
  it('シナリオを止まった状態で作る', async () => {
    db.getRecipeById.mockResolvedValue({
      ...RECIPE,
      items_json: JSON.stringify([{ kind: 'シナリオ', name: '7日間', note: '7通' }]),
    });
    await makeApp().fetch(clone({ accountId: 'acc-1' }), env);
    const sql = prepare.mock.calls.map((call) => String(call[0])).find((s) => /INSERT INTO scenarios/.test(s));
    expect(sql).toBeDefined();
    expect(sql).toContain('0, datetime');
  });

  it('見えないアカウントには作らない', async () => {
    accountAccess.canAccessAllLineAccounts.mockResolvedValue(false);
    const res = await makeApp().fetch(clone({ accountId: 'acc-他' }), env);
    expect(res.status).toBe(404);
    expect(db.startCloneRun).not.toHaveBeenCalled();
  });
});
