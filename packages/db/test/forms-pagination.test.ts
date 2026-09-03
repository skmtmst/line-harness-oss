import { describe, expect, it, vi } from 'vitest';
import { getFormSubmissions, getFormSubmissionsPage } from '../src/forms.js';

describe('getFormSubmissionsPage', () => {
  it('counts all rows but only returns the requested page', async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...bindings: unknown[]) => {
          calls.push({ sql, bindings });
          return {
            first: vi.fn(async () => ({ total: 73 })),
            all: vi.fn(async () => ({
              results: [{
                id: 'submission-21', form_id: 'form-1', friend_id: 'friend-1',
                friend_name: '山田', data: '{}', created_at: '2026-08-27T12:00:00+09:00',
              }],
            })),
          };
        },
      })),
    } as unknown as D1Database;

    const result = await getFormSubmissionsPage(db, 'form-1', { page: 2, limit: 20 });
    expect(result).toMatchObject({ total: 73, page: 2, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(calls[0].bindings).toEqual(['form-1']);
    expect(calls[1].bindings).toEqual(['form-1', 20, 20]);
    expect(calls[1].sql).toContain('ORDER BY fs.created_at DESC, fs.id DESC');
    expect(calls[1].sql).toContain('LIMIT ? OFFSET ?');
  });

  it('caps display count at 200 and never accepts a page below 1', async () => {
    const bindings: unknown[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...values: unknown[]) => {
          bindings.push(values);
          return sql.includes('COUNT')
            ? { first: vi.fn(async () => ({ total: 0 })) }
            : { all: vi.fn(async () => ({ results: [] })) };
        },
      })),
    } as unknown as D1Database;

    const result = await getFormSubmissionsPage(db, 'form-1', { page: -5, limit: 500 });
    expect(result).toMatchObject({ total: 0, page: 1, limit: 200 });
    expect(bindings[1]).toEqual(['form-1', 200, 0]);
  });

  it('keeps the compatibility array query capped at 200', async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...bindings: unknown[]) => {
          calls.push({ sql, bindings });
          return { all: vi.fn(async () => ({ results: [] })) };
        },
      })),
    } as unknown as D1Database;

    await getFormSubmissions(db, 'form-1');
    expect(calls[0].sql).toContain('LIMIT ?');
    expect(calls[0].bindings).toEqual(['form-1', 200]);
  });
});
