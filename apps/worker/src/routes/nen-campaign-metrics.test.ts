import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../index.js';

const accessMocks = vi.hoisted(() => ({ canAccessAllLineAccounts: vi.fn() }));
const metricsMocks = vi.hoisted(() => ({
  getNenFlowMetrics: vi.fn(),
  getNenColumnMetrics: vi.fn(),
  getNenPetMetrics: vi.fn(),
  listNenDeliveries: vi.fn(),
  getNenDeliveryDetail: vi.fn(),
  retryNenDelivery: vi.fn(),
}));
const auditLog = vi.hoisted(() => vi.fn());

vi.mock('../services/account-access.js', () => accessMocks);
vi.mock('../lib/audit-log.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/audit-log.js')>()),
  auditLog,
}));
vi.mock('../services/nen-campaign-metrics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/nen-campaign-metrics.js')>()),
  ...metricsMocks,
}));

const { nenCampaigns } = await import('./nen-campaigns.js');
const { NenCampaignMetricsError } = await import('../services/nen-campaign-metrics.js');

type Role = 'owner' | 'admin' | 'staff';

function app(role: Role = 'owner') {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database } as Env['Bindings'];
    c.set('staff', {
      id: 'staff-1', name: '担当者', role, readOnly: false, tenantId: 'tenant-1',
      permissionKeys: ['/nen-campaigns'], assignedLineAccountId: null,
      canAccessDescendantAccounts: false,
    });
    await next();
  });
  hono.route('/', nenCampaigns);
  return hono;
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  metricsMocks.getNenFlowMetrics.mockResolvedValue({ summary: { sent: 1 }, flows: [] });
  metricsMocks.getNenColumnMetrics.mockResolvedValue({ summary: { total: 0 }, columns: [] });
  metricsMocks.getNenPetMetrics.mockResolvedValue({ summary: { pets: 0 }, pets: [] });
  metricsMocks.listNenDeliveries.mockResolvedValue({ deliveries: [], pagination: { total: 0 } });
  metricsMocks.getNenDeliveryDetail.mockResolvedValue({ id: 'job-1', status: 'failed', version: 1 });
  metricsMocks.retryNenDelivery.mockResolvedValue({ id: 'job-1', status: 'pending', version: 2 });
});

describe('NEN campaign V6 metric routes', () => {
  it('通常・空状態を成功応答で返し、期間とページ条件をserviceへ渡す', async () => {
    const flows = await app('staff').request(
      '/api/nen-campaigns/metrics/flows?lineAccountId=account-a&days=14',
    );
    expect(flows.status).toBe(200);
    await expect(flows.json()).resolves.toMatchObject({ success: true, data: { summary: { sent: 1 } } });
    expect(metricsMocks.getNenFlowMetrics).toHaveBeenCalledWith(
      expect.anything(), 'account-a', expect.objectContaining({ days: 14 }),
    );

    const deliveries = await app('staff').request(
      '/api/nen-campaigns/deliveries?lineAccountId=account-a&status=failed&cursor=10&limit=25',
    );
    expect(deliveries.status).toBe(200);
    await expect(deliveries.json()).resolves.toMatchObject({ success: true, data: { deliveries: [] } });
    expect(metricsMocks.listNenDeliveries).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({
        lineAccountId: 'account-a', status: 'failed', cursor: 10, limit: 25,
      }),
    );
  });

  it('DB失敗を500で返し、空状態へ置き換えない', async () => {
    metricsMocks.getNenPetMetrics.mockRejectedValueOnce(new Error('db unavailable'));
    const response = await app().request(
      '/api/nen-campaigns/metrics/pets?lineAccountId=account-a',
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false, error: 'NEN配信の情報を取得できませんでした',
    });
  });

  it('担当外アカウントはserviceを呼ばず403にする', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const response = await app('staff').request(
      '/api/nen-campaigns/metrics/columns?lineAccountId=account-b',
    );
    expect(response.status).toBe(403);
    expect(metricsMocks.getNenColumnMetrics).not.toHaveBeenCalled();
  });

  it('staffは閲覧できるが手動再送できない', async () => {
    const detail = await app('staff').request(
      '/api/nen-campaigns/deliveries/job-1?lineAccountId=account-a',
    );
    expect(detail.status).toBe(200);

    const retry = await app('staff').request(
      '/api/nen-campaigns/deliveries/job-1/retry',
      post({ lineAccountId: 'account-a', expectedVersion: 1, reason: '確認済み' }),
    );
    expect(retry.status).toBe(403);
    expect(metricsMocks.retryNenDelivery).not.toHaveBeenCalled();
  });

  it('ownerの再送を監査し、版競合409をそのまま返す', async () => {
    const succeeded = await app('owner').request(
      '/api/nen-campaigns/deliveries/job-1/retry',
      post({ lineAccountId: 'account-a', expectedVersion: 1, reason: 'お客様確認済み' }),
    );
    expect(succeeded.status).toBe(200);
    expect(metricsMocks.retryNenDelivery).toHaveBeenCalledWith(expect.anything(), {
      id: 'job-1', lineAccountId: 'account-a', expectedVersion: 1,
      reason: 'お客様確認済み', staffId: 'staff-1',
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(), 'nen.delivery.retry', { kind: 'nen_delivery', id: 'job-1' },
    );

    metricsMocks.retryNenDelivery.mockRejectedValueOnce(
      new NenCampaignMetricsError('version_conflict', '読み直してください', 409),
    );
    const conflict = await app('admin').request(
      '/api/nen-campaigns/deliveries/job-1/retry',
      post({ lineAccountId: 'account-a', expectedVersion: 1, reason: '重複操作' }),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      success: false, code: 'version_conflict', error: '読み直してください',
    });
  });
});
