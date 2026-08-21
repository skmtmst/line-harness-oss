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
  test('returns only fields needed by the inbox assignee picker', async () => {
    const app = new Hono<Env>();
    app.route('/', chats);
    const response = await app.request('/api/operators', {}, { DB: {} as D1Database } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: [{ id: 'staff-1', name: '担当者' }],
    });
  });
});
