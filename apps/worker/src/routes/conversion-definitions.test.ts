import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getConversionPoints: vi.fn(),
  getConversionPointById: vi.fn(),
  createConversionPoint: vi.fn(),
  updateConversionPoint: vi.fn(),
  stopConversionPoint: vi.fn(),
  trackConversion: vi.fn(),
  getConversionEvents: vi.fn(),
  getConversionReport: vi.fn(),
  getConversionApprovalQueue: vi.fn(),
  setConversionApproval: vi.fn(),
  getConversionApprovalNotifyInfo: vi.fn(),
  syncAffiliateConversionMileage: vi.fn(),
  listConversionDefinitions: vi.fn(),
  getConversionDefinitionDetail: vi.fn(),
  addConversionDefinitionUsage: vi.fn(),
  createConversionDefinition: vi.fn(),
  previewConversionDefinition: vi.fn(),
  getConversionDefinitionDeleteImpact: vi.fn(),
  stopConversionDefinition: vi.fn(),
  replaceConversionDefinitionUsages: vi.fn(),
  deleteUnusedConversionDefinition: vi.fn(),
  getConversionDefinitionReport: vi.fn(),
  listConversionDefinitionsForExport: vi.fn(),
}));
const contractMocks = vi.hoisted(() => ({
  ConversionDefinitionError: class ConversionDefinitionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: 400 | 404 | 409 = 409,
    ) {
      super(message);
    }
  },
}));
const accountMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  ...dbMocks,
  ConversionDefinitionError: contractMocks.ConversionDefinitionError,
  CONVERSION_DEFINITION_USAGE_KINDS: [
    'affiliate_offer', 'analytics', 'auto_reply', 'scenario', 'nen_campaign',
    'mileage_rule', 'automation', 'ad_platform',
  ],
}));
vi.mock('../services/account-access.js', () => accountMocks);
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

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const LIST_RESULT = {
  items: [],
  stateCounts: { active: 0, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0 },
  range: { from: '2026-09-01 00:00:00', to: '2026-09-07 23:59:59', timeZone: 'Asia/Tokyo' },
  pagination: { total: 0, limit: 50, cursor: '0', nextCursor: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  accountMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  accountMocks.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-a'], canSeeUnassigned: false,
  });
  dbMocks.listConversionDefinitions.mockResolvedValue(LIST_RESULT);
  dbMocks.getConversionDefinitionDetail.mockResolvedValue(null);
  dbMocks.getConversionDefinitionReport.mockResolvedValue({
    kpis: { netCount: 0 }, daily: [], byDefinition: [], byRoute: [],
  });
  dbMocks.listConversionDefinitionsForExport.mockResolvedValue([]);
  dbMocks.createConversionDefinition.mockResolvedValue({ id: 'point-new', name: '動画完了' });
  dbMocks.previewConversionDefinition.mockResolvedValue({ estimatedCount: 214, estimatedValue: 402800 });
  dbMocks.getConversionDefinitionDeleteImpact.mockResolvedValue({
    definition: { id: 'point-a', version: 1 }, usages: [], eventCount: 0, canDelete: true,
    stopImpact: { affectedUsageCount: 0, preservesPastEvents: true, preservesUsages: true },
    replacementCandidates: [],
  });
  dbMocks.stopConversionDefinition.mockResolvedValue({ id: 'point-a', status: 'stopped', version: 2 });
  dbMocks.replaceConversionDefinitionUsages.mockResolvedValue({ id: 'point-a', replacementId: 'point-b', replacedUsageCount: 3, status: 'stopped', version: 2 });
  dbMocks.deleteUnusedConversionDefinition.mockResolvedValue({ id: 'point-a', deleted: true });
});

describe('conversion definition V6 routes', () => {
  it('通常・空状態を成功応答にし、一覧条件をDBへ渡す', async () => {
    const response = await app().request(
      '/api/conversions/definitions?from=2026-09-01&to=2026-09-07&lineAccountId=account-a&q=%E8%B3%BC%E5%85%A5&status=active&sourceType=purchase&sort=value_desc',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: LIST_RESULT });
    expect(dbMocks.listConversionDefinitions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lineAccountId: 'account-a', query: '購入', status: 'active', sourceType: 'purchase',
      sort: 'value_desc', cursor: 0, limit: 50,
      scope: { allowedAccountIds: ['account-a'], includeUnassigned: false },
    }));
  });

  it('DB失敗を500で返し、空状態に置き換えない', async () => {
    dbMocks.listConversionDefinitions.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await app().request('/api/conversions/definitions?from=2026-09-01&to=2026-09-07');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: '成果地点の情報を処理できませんでした' });
  });

  it('日付・状態・cursorの入力不良を400で拒否する', async () => {
    expect((await app().request('/api/conversions/definitions?from=2026-09-07&to=2026-09-01')).status).toBe(400);
    expect((await app().request('/api/conversions/definitions?status=draft')).status).toBe(400);
    expect((await app().request('/api/conversions/definitions?cursor=-1')).status).toBe(400);
    expect(dbMocks.listConversionDefinitions).not.toHaveBeenCalled();
  });

  it('閲覧権限の無いstaffを403で拒否する', async () => {
    const response = await app('staff', []).request('/api/conversions/definitions');
    expect(response.status).toBe(403);
    expect(dbMocks.listConversionDefinitions).not.toHaveBeenCalled();
  });

  it('担当外アカウントの一覧は403、詳細は404で隠す', async () => {
    accountMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const list = await app('staff').request('/api/conversions/definitions?lineAccountId=account-b');
    expect(list.status).toBe(403);

    const detail = await app('staff').request('/api/conversions/definitions/point-hidden');
    expect(detail.status).toBe(404);
    expect(dbMocks.getConversionDefinitionDetail).toHaveBeenCalledWith(
      expect.anything(), 'point-hidden', expect.objectContaining({ allowedAccountIds: ['account-a'] }),
    );
  });

  it('詳細は版と利用先をそのまま返す', async () => {
    dbMocks.getConversionDefinitionDetail.mockResolvedValueOnce({
      id: 'point-a', currentVersion: { number: 3 }, usages: [{ refKind: 'scenario', refId: 'scenario-1' }],
    });
    const response = await app().request('/api/conversions/definitions/point-a');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, data: { currentVersion: { number: 3 }, usages: [{ refKind: 'scenario' }] },
    });
  });

  it('利用先追加は二重権限・アカウント・版競合を守る', async () => {
    const body = { lineAccountId: 'account-a', expectedVersion: 3, refKind: 'scenario', refId: 'scenario-1' };
    expect((await app('staff', ['/conversions']).request(
      '/api/conversions/definitions/point-a/usages', json(body),
    )).status).toBe(403);

    dbMocks.addConversionDefinitionUsage.mockRejectedValueOnce(
      new contractMocks.ConversionDefinitionError('version_conflict', '読み直してください', 409),
    );
    const conflict = await app('staff', ['/conversions', 'conversion.definition.edit']).request(
      '/api/conversions/definitions/point-a/usages', json(body),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ success: false, code: 'version_conflict' });

    accountMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const hidden = await app('staff', ['/conversions', 'conversion.definition.edit']).request(
      '/api/conversions/definitions/point-a/usages', json({ ...body, lineAccountId: 'account-b' }),
    );
    expect(hidden.status).toBe(404);
  });

  it('新規bindingは201、同じ再送は200で返す', async () => {
    const body = { lineAccountId: 'account-a', expectedVersion: 1, refKind: 'analytics', refId: 'report-1' };
    dbMocks.addConversionDefinitionUsage.mockResolvedValueOnce({ created: true, usage: { id: 'usage-1' }, currentVersion: 1 });
    const created = await app().request('/api/conversions/definitions/point-a/usages', json(body));
    expect(created.status).toBe(201);
    dbMocks.addConversionDefinitionUsage.mockResolvedValueOnce({ created: false, usage: { id: 'usage-1' }, currentVersion: 1 });
    const repeated = await app().request('/api/conversions/definitions/point-a/usages', json(body));
    expect(repeated.status).toBe(200);
  });

  it('レポートはV6構造、旧日付クエリは既存画面向け配列を返す', async () => {
    const report = await app('staff').request('/api/conversions/report?from=2026-09-01&to=2026-09-07');
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ success: true, data: { kpis: { netCount: 0 }, daily: [] } });

    dbMocks.getConversionReport.mockResolvedValueOnce([]);
    const legacy = await app('staff').request('/api/conversions/report?startDate=2026-09-01&endDate=2026-09-07');
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual({ success: true, data: [] });
  });

  it('CSVは専用権限と一覧同条件を使い、空でも定義ヘッダーを返す', async () => {
    expect((await app('staff').request('/api/conversions/export')).status).toBe(403);
    const response = await app('staff', ['/conversions', 'conversion.report.export']).request(
      '/api/conversions/export?from=2026-09-01&to=2026-09-07&status=active',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const csv = await response.text();
    expect(csv).toContain('期間開始');
    expect(csv).toContain('タイムゾーン');
    expect(csv).toContain('純額定義');
    expect(dbMocks.listConversionDefinitionsForExport).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ status: 'active', sort: 'count_desc' }),
    );
  });

  it('動画・30日1回・取消・利用先をまとめて作成する', async () => {
    const body = {
      name: '動画完了', sourceType: 'webinar_completed', sourceConfig: { webinarId: 'webinar-1' },
      lineAccountId: 'account-a', deduplicationMode: 'window', deduplicationWindowDays: 30,
      valueMode: 'none', reversalPolicy: 'none', attributionDays: 30,
      usages: [{ refKind: 'analytics', refId: 'analysis-1' }],
    };
    const response = await app().request('/api/conversions/definitions', json(body));
    expect(response.status).toBe(201);
    expect(dbMocks.createConversionDefinition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sourceType: 'webinar_completed', deduplicationMode: 'window', deduplicationWindowDays: 30,
      usages: [{ refKind: 'analytics', refId: 'analysis-1', refVersionId: null }],
    }));
  });

  it('入力だけの試算は保存を呼ばず、担当外アカウントを隠す', async () => {
    const body = {
      sourceType: 'ec_order_confirmed', sourceConfig: {}, lineAccountId: 'account-a',
      deduplicationMode: 'once_per_friend', valueMode: 'source',
    };
    const response = await app().request('/api/conversions/definitions/preview', json(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { estimatedCount: 214 } });
    expect(dbMocks.createConversionDefinition).not.toHaveBeenCalled();

    accountMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    expect((await app().request('/api/conversions/definitions/preview', json({ ...body, lineAccountId: 'account-b' }))).status).toBe(404);
  });

  it('削除影響、停止、差し替え、未使用削除を版付きで呼ぶ', async () => {
    expect((await app().request('/api/conversions/definitions/point-a/delete-impact')).status).toBe(200);

    const stopped = await app().request('/api/conversions/definitions/point-a/stop', json({ expectedVersion: 1 }));
    expect(stopped.status).toBe(200);
    expect(dbMocks.stopConversionDefinition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedVersion: 1 }));

    const replaced = await app().request('/api/conversions/definitions/point-a/replace', json({
      expectedVersion: 1, replacementId: 'point-b', replacementExpectedVersion: 2,
    }));
    expect(replaced.status).toBe(200);
    expect(dbMocks.replaceConversionDefinitionUsages).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ replacementId: 'point-b' }));

    const deleted = await app().request('/api/conversions/definitions/point-a', {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }),
    });
    expect(deleted.status).toBe(200);
    expect(dbMocks.deleteUnusedConversionDefinition).toHaveBeenCalled();
  });

  it('作成・停止・差し替えの不正入力をDBへ渡さない', async () => {
    expect((await app().request('/api/conversions/definitions', json({ name: '不足' }))).status).toBe(400);
    expect((await app().request('/api/conversions/definitions/point-a/stop', json({ expectedVersion: 0 }))).status).toBe(400);
    expect((await app().request('/api/conversions/definitions/point-a/replace', json({ expectedVersion: 1 }))).status).toBe(400);
    expect(dbMocks.createConversionDefinition).not.toHaveBeenCalled();
  });
});

describe('点検・軽 第7便の口の整理(#585)', () => {
  it('削除は本文が落ちてもクエリの版で受け付ける(#513 L11)', async () => {
    const viaQuery = await app().request('/api/conversions/definitions/point-a?expectedVersion=1', { method: 'DELETE' });
    expect(viaQuery.status).toBe(200);
    expect(dbMocks.deleteUnusedConversionDefinition).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ expectedVersion: 1 }),
    );
  });

  it('削除は版がどこにも無ければ案内文で400にする(#513 L11)', async () => {
    const response = await app().request('/api/conversions/definitions/point-a', { method: 'DELETE' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false, error: 'expectedVersionを正しく指定してください。本文が落ちる通信経路ではクエリでも指定できます',
    });
  });

  it('イベントの日付は厳密な暦日だけ受け付ける(#513 L12)', async () => {
    dbMocks.getConversionEvents.mockResolvedValue([]);
    const ok = await app().request('/api/conversions/events?startDate=2026-09-01&endDate=2026-09-07');
    expect(ok.status).toBe(200);
    for (const bad of ['not-a-date', '2026-13-01', '2026-02-30', '2026-9-1']) {
      const response = await app().request(`/api/conversions/events?startDate=${bad}`);
      expect(response.status).toBe(400);
    }
    expect(dbMocks.getConversionEvents).toHaveBeenCalledTimes(1);
  });

  it('停止・差し替えの理由は200文字まで(#513 L14)', async () => {
    const long = 'あ'.repeat(201);
    const stopped = await app().request('/api/conversions/definitions/point-a/stop', json({ expectedVersion: 1, reason: long }));
    expect(stopped.status).toBe(400);
    const replaced = await app().request('/api/conversions/definitions/point-a/replace', json({
      expectedVersion: 1, replacementId: 'point-b', replacementExpectedVersion: 2, reason: long,
    }));
    expect(replaced.status).toBe(400);
    expect(dbMocks.stopConversionDefinition).not.toHaveBeenCalled();
    expect(dbMocks.replaceConversionDefinitionUsages).not.toHaveBeenCalled();
  });

  it('定義作成の対象URLは2000文字まで(#513 L14)', async () => {
    const response = await app().request('/api/conversions/definitions', json({
      name: '長いURL', sourceType: 'url_reach', sourceConfig: {},
      lineAccountId: 'account-a', deduplicationMode: 'once_per_friend',
      valueMode: 'none', reversalPolicy: 'none',
      targetUrl: `https://example.com/${'a'.repeat(2000)}`,
    }));
    expect(response.status).toBe(400);
    expect(dbMocks.createConversionDefinition).not.toHaveBeenCalled();
  });
});
