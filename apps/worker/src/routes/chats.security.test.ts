import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

vi.mock('@line-crm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@line-crm/db')>();
  return {
    ...actual,
    getOperators: vi.fn(async () => [{
      id: 'staff-1', name: '担当者', email: 'private@example.com', role: 'staff',
      is_active: 1, created_at: '2026-08-21', updated_at: '2026-08-21',
    }]),
  };
});

import { chats } from './chats.js';

describe('GET /api/operators response', () => {
  const appFor = (role: 'owner' | 'admin' | 'staff' | null) => {
    const app = new Hono<Env>();
    if (role) {
      app.use('*', async (c, next) => {
        c.set('staff', { id: 'staff-1', name: '担当者', role, readOnly: false });
        await next();
      });
    }
    app.route('/', chats);
    return app;
  };

  test('returns only fields needed by the inbox assignee picker', async () => {
    const response = await appFor('staff').request('/api/operators', {}, { DB: {} as D1Database } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: [{ id: 'staff-1', name: '担当者' }],
    });
  });

  test('rejects an unauthenticated operator-list request', async () => {
    const response = await appFor(null).request('/api/operators', {}, { DB: {} as D1Database } as Env['Bindings']);
    expect(response.status).toBe(403);
  });
});
