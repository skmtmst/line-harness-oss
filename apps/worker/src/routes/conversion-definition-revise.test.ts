import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

/*
 * POST /api/conversions/definitions/:id/revise の口の契約（N-252）。
 *
 * ここで見るのは口の約束だけ（権限・入力の検証・版の受け取り・DBへ渡す形・
 * 例外の写し方）。実際にDBが何を書くかは
 * packages/db/test/377_conversion_point_version_edit.test.ts と
 * 377_conversion_revise_two_connection.test.ts が実DB相当で見ている。
 */

const dbMocks = vi.hoisted(() => ({
  getConversionPoints: vi.fn(), getConversionPointById: vi.fn(), createConversionPoint: vi.fn(),
  updateConversionPoint: vi.fn(), stopConversionPoint: vi.fn(), trackConversion: vi.fn(),
  getConversionEvents: vi.fn(), getConversionReport: vi.fn(), getConversionApprovalQueue: vi.fn(),
  setConversionApproval: vi.fn(), getConversionApprovalNotifyInfo: vi.fn(),
  syncAffiliateConversionMileage: vi.fn(), listConversionDefinitions: vi.fn(),
  getConversionDefinitionDetail: vi.fn(), addConversionDefinitionUsage: vi.fn(),
  createConversionDefinition: vi.fn(), previewConversionDefinition: vi.fn(),
  getConversionDefinitionDeleteImpact: vi.fn(), stopConversionDefinition: vi.fn(),
  replaceConversionDefinitionUsages: vi.fn(), deleteUnusedConversionDefinition: vi.fn(),
  getConversionDefinitionReport: vi.fn(), listConversionDefinitionsForExport: vi.fn(),
  reviseConversionDefinition: vi.fn(),
}));
const contractMocks = vi.hoisted(() => ({
  ConversionDefinitionError: class ConversionDefinitionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: 400 | 404 | 409 = 409,
    ) { super(message); }
  },
}));
const accountMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(), getVisibleLineAccountScope: vi.fn(),
}));
const auditMocks = vi.hoisted(() => ({ auditLog: vi.fn() }));

vi.mock('@line-crm/db', () => ({
  ...dbMocks,
  ConversionDefinitionError: contractMocks.ConversionDefinitionError,
  CONVERSION_DEFINITION_USAGE_KINDS: [
    'affiliate_offer', 'analytics', 'auto_reply', 'scenario', 'nen_campaign',
    'mileage_rule', 'automation', 'ad_platform',
  ],
}));
vi.mock('../services/account-access.js', () => accountMocks);
vi.mock('../lib/audit-log.js', () => auditMocks);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateApproval: vi.fn() }));

const { conversions } = await import('./conversions.js');

type Role = 'owner' | 'admin' | 'staff';

function app(role: Role = 'owner', permissionKeys: string[] = ['/conversions']) {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ all: vi.fn(async () => ({ results: [{ id: 'point-a' }] })) })),
        })),
      } as unknown as D1Database,
    } as Env['Bindings'];
    c.set('staff', {
      id: 'staff-1', name: '担当者', role, readOnly: false, permissionKeys,
      tenantId: 'tenant-1', assignedLineAccountId: null, canAccessDescendantAccounts: false,
    });
    await next();
  });
  hono.route('/', conversions);
  return hono;
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** 妥当な編集の本文。個別の試験はここから1つだけ崩す。 */
function validBody(over: Record<string, unknown> = {}) {
  return {
    expectedVersion: 1,
    name: '購入（改）',
    sourceType: 'form_submitted',
    sourceConfig: {},
    deduplicationMode: 'every',
    valueMode: 'fixed',
    fixedValue: 500,
    reversalPolicy: 'manual',
    ...over,
  };
}

const URL = '/api/conversions/definitions/point-a/revise';

beforeEach(() => {
  vi.clearAllMocks();
  accountMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  accountMocks.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-a'], canSeeUnassigned: false,
  });
  dbMocks.reviseConversionDefinition.mockResolvedValue({
    id: 'point-a', version: 2, revisionId: 'rev-1', movedUsages: 1, updatedAt: '2026-09-11T10:00:00.000+09:00',
  });
  dbMocks.createConversionDefinition.mockResolvedValue({ id: 'point-new' });
  dbMocks.stopConversionDefinition.mockResolvedValue({ id: 'point-a', status: 'stopped', version: 2 });
  dbMocks.replaceConversionDefinitionUsages.mockResolvedValue({ id: 'point-a', version: 2 });
  dbMocks.deleteUnusedConversionDefinition.mockResolvedValue({ id: 'point-a', deleted: true });
});

describe('成果地点の編集の口（N-252）', () => {
  it('編集を受け付け、版と店の視野をDBへ渡す', async () => {
    const response = await app().request(URL, post(validBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { id: 'point-a', version: 2, revisionId: 'rev-1', movedUsages: 1, updatedAt: '2026-09-11T10:00:00.000+09:00' },
    });
    expect(dbMocks.reviseConversionDefinition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: 'point-a',
      expectedVersion: 1,
      name: '購入（改）',
      valueMode: 'fixed',
      fixedValue: 500,
      staffId: 'staff-1',
      scope: { allowedAccountIds: ['account-a'], includeUnassigned: false },
    }));
  });

  /*
   * 店は「その地点が属している店」が正本。本文で別の店を渡されても、
   * それを編集の入力として通さない（渡すと他店の地点を書き換える口になる）。
   */
  it('本文の lineAccountId は編集の入力として使わない', async () => {
    const response = await app().request(URL, post(validBody({ lineAccountId: 'account-zzz' })));
    expect(response.status).toBe(200);
    const passed = dbMocks.reviseConversionDefinition.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(passed).not.toHaveProperty('lineAccountId');
    expect(passed.scope).toEqual({ allowedAccountIds: ['account-a'], includeUnassigned: false });
  });

  it('版が無い・0以下なら400にして、DBを呼ばない', async () => {
    // 数字の文字列は通す（本文が落ちる経路ではクエリで届くため。停止・差し替えと同じ約束）。
    for (const bad of [undefined, 0, -1, 1.5, 'abc', null, {}]) {
      vi.clearAllMocks();
      const body = validBody();
      if (bad === undefined) delete (body as Record<string, unknown>).expectedVersion;
      else (body as Record<string, unknown>).expectedVersion = bad;
      const response = await app().request(URL, post(body));
      expect(response.status).toBe(400);
      expect(dbMocks.reviseConversionDefinition).not.toHaveBeenCalled();
    }
  });

  it('入力が不正なら400にして、DBを呼ばない', async () => {
    const cases: Array<Record<string, unknown>> = [
      { name: '' },
      { name: 'あ'.repeat(121) },
      { sourceType: 'unknown_source' },
      { deduplicationMode: 'sometimes' },
      { valueMode: 'fixed', fixedValue: null },
      { valueMode: 'fixed', fixedValue: -1 },
      { deduplicationMode: 'window', deduplicationWindowDays: 0 },
      { deduplicationMode: 'window', deduplicationWindowDays: 366 },
      { reversalPolicy: 'whenever' },
      { attributionDays: 400 },
    ];
    for (const over of cases) {
      vi.clearAllMocks();
      const response = await app().request(URL, post(validBody(over)));
      expect(response.status, JSON.stringify(over)).toBe(400);
      expect(dbMocks.reviseConversionDefinition).not.toHaveBeenCalled();
    }
  });

  it('編集の権限が無い担当者は403で、DBを呼ばない', async () => {
    const response = await app('staff', []).request(URL, post(validBody()));
    expect(response.status).toBe(403);
    expect(dbMocks.reviseConversionDefinition).not.toHaveBeenCalled();
  });

  it('版の競合はそのまま409で返す', async () => {
    dbMocks.reviseConversionDefinition.mockRejectedValue(
      new contractMocks.ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409),
    );
    const response = await app().request(URL, post(validBody()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'version_conflict' });
  });

  it('視野の外の地点は404で返す', async () => {
    dbMocks.reviseConversionDefinition.mockRejectedValue(
      new contractMocks.ConversionDefinitionError('not_found', '成果地点が見つかりません', 404),
    );
    const response = await app().request(URL, post(validBody()));
    expect(response.status).toBe(404);
  });

  it('理由は長すぎれば400（停止・差し替えと同じ約束）', async () => {
    const response = await app().request(URL, post(validBody({ reason: 'あ'.repeat(1000) })));
    expect(response.status).toBe(400);
    expect(dbMocks.reviseConversionDefinition).not.toHaveBeenCalled();
  });
});

/*
 * 成果地点を変える口が、全部そろって監査ログを残すこと。
 *
 * 行為名を union へ足しただけでは、呼び忘れても型が通る。**呼んでいるか**を見る。
 * ここに並べた5つについては、呼び忘れも行為名の使い回しも落ちる。
 *
 * **6つ目の口が増えたときは、この一覧に足し忘れると落ちない。**
 * 一覧はべた書きで、router から口を数えてはいないため。
 * 独立審査（#658）が、監査ログを呼ばない6つ目の口を足して一覧に入れない変異を
 * 当て、この試験が14件とも緑のままになることを実測している。
 * 黙って入ることはない（`openapi-coverage.test.ts` が router から口を数えるので
 * 記載漏れで落ちる）が、**止まる理由は「記載漏れ」であって「監査ログの呼び忘れ」
 * ではない。**記載を足したうえで `auditLog` を忘れる余地は残る。
 * 本当に止めるなら、この一覧をやめて router から口を数える形にする。
 */
const MUTATING_ENDPOINTS: Array<{
  action: string;
  /** `hono.request()` は Response をそのまま返すこともあるので、どちらも受ける。 */
  request: () => Response | Promise<Response>;
}> = [
  {
    action: 'conversion.definition.create',
    request: () => app().request('/api/conversions/definitions', post({
      ...validBody(), lineAccountId: 'account-a', usages: [],
    })),
  },
  {
    action: 'conversion.definition.stop',
    request: () => app().request('/api/conversions/definitions/point-a/stop', post({ expectedVersion: 1 })),
  },
  {
    action: 'conversion.definition.revise',
    request: () => app().request(URL, post(validBody())),
  },
  {
    action: 'conversion.definition.replace',
    request: () => app().request('/api/conversions/definitions/point-a/replace', post({
      expectedVersion: 1, replacementExpectedVersion: 1, replacementId: 'point-b',
    })),
  },
  {
    action: 'conversion.definition.delete',
    request: () => app().request('/api/conversions/definitions/point-a', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1 }),
    }),
  },
];

describe('成果地点を変える口は、全部そろって監査ログを残す', () => {
  it.each(MUTATING_ENDPOINTS)('$action を残す', async ({ action, request }) => {
    const response = await request();
    expect(response.status, await response.text()).toBeLessThan(300);
    const actions = auditMocks.auditLog.mock.calls.map((call) => call[1] as string);
    expect(actions).toContain(action);
  });

  it('5つの口で、5つとも別々の行為名が残る（使い回していない）', async () => {
    const seen: string[] = [];
    for (const endpoint of MUTATING_ENDPOINTS) {
      vi.clearAllMocks();
      accountMocks.canAccessAllLineAccounts.mockResolvedValue(true);
      accountMocks.getVisibleLineAccountScope.mockResolvedValue({
        allowedAccountIds: ['account-a'], canSeeUnassigned: false,
      });
      dbMocks.createConversionDefinition.mockResolvedValue({ id: 'point-new' });
      dbMocks.stopConversionDefinition.mockResolvedValue({ id: 'point-a', status: 'stopped', version: 2 });
      dbMocks.replaceConversionDefinitionUsages.mockResolvedValue({ id: 'point-a', version: 2 });
      dbMocks.deleteUnusedConversionDefinition.mockResolvedValue({ id: 'point-a', deleted: true });
      dbMocks.reviseConversionDefinition.mockResolvedValue({ id: 'point-a', version: 2, revisionId: 'rev-1', movedUsages: 0 });
      await endpoint.request();
      seen.push(...auditMocks.auditLog.mock.calls.map((call) => call[1] as string));
    }
    expect(new Set(seen).size).toBe(MUTATING_ENDPOINTS.length);
    expect([...new Set(seen)].sort()).toEqual(MUTATING_ENDPOINTS.map((e) => e.action).sort());
  });
});
