import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const recordAuditEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@line-crm/db', () => ({
  recordAuditEvent,
  maskAuditIp: (ip?: string) => ip ? '203.0.113.***' : null,
  auditDeviceFamily: () => 'mac',
}));

const { businessAuditMiddleware } = await import('./business-audit.js');

function app(explicitAudit = false) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当', role: 'admin', readOnly: false, tenantId: 'tenant-a' });
    if (explicitAudit) c.set('auditRecorded', true);
    return next();
  });
  instance.use('/api/*', businessAuditMiddleware);
  instance.post('/api/widgets/:id', (c) => c.json({ success: true }));
  instance.get('/api/widgets/:id', (c) => c.json({ success: true }));
  return instance;
}

describe('businessAuditMiddleware', () => {
  it('records a mutating route pattern without reading request body', async () => {
    recordAuditEvent.mockClear();
    const response = await app().request('/api/widgets/widget-secret?lineAccountId=account-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.42' },
      body: JSON.stringify({ password: 'never-store-this' }),
    }, { DB: { prepare: vi.fn() } as unknown as D1Database });
    expect(response.status).toBe(200);
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 'tenant-a', lineAccountId: 'account-a', action: 'api.post./api/widgets/:id',
      targetKind: 'widgets', targetId: 'widget-secret', result: 'success', ipPrefix: '203.0.113.***',
    }));
    expect(JSON.stringify(recordAuditEvent.mock.calls[0])).not.toContain('never-store-this');
  });

  it('does not record GET or duplicate an explicit route audit', async () => {
    recordAuditEvent.mockClear();
    await app().request('/api/widgets/a', {}, { DB: { prepare: vi.fn() } as unknown as D1Database });
    await app(true).request('/api/widgets/a', { method: 'POST' }, { DB: { prepare: vi.fn() } as unknown as D1Database });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
