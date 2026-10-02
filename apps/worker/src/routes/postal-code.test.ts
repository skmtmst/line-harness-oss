import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getPostalReadiness: vi.fn(),
  searchPostalCodes: vi.fn(),
  normalizePostalQuery: (value: unknown) => {
    if (typeof value !== 'string') return null;
    const digits = value.replace(/[^0-9]/g, '');
    return /^\d{7}$/.test(digits) ? digits : null;
  },
}));
vi.mock('@line-crm/db', () => dbMocks);

import { postalCode } from './postal-code.js';

function app() {
  const hono = new Hono<Env>();
  hono.route('/', postalCode);
  return hono;
}

const bindings = { DB: {} as D1Database } as Env['Bindings'];

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getPostalReadiness.mockResolvedValue({
    fullDataset: false, rowCount: 0, importedAt: null, source: null,
  });
  dbMocks.searchPostalCodes.mockImplementation(async (_db: unknown, digits: string, fallback: Array<{ postalCode: string }>) => {
    const candidates = fallback.filter((row) => row.postalCode === digits);
    return { candidates, fromDb: false, total: candidates.length };
  });
});

describe('F11 郵便番号検索', () => {
  it('先頭0を保ち、複数候補を潰さない', async () => {
    const res = await app().request('/api/postal-code/search?code=100-0001', {}, bindings);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { normalized: string; status: string; candidates: Array<{ town: string }>; readiness: { fullDataset: boolean } } };
    expect(body.data.normalized).toBe('1000001');
    expect(body.data.status).toBe('multiple');
    expect(body.data.candidates.length).toBe(2);
  });

  it('該当なし・無効入力・手入力保持を返す', async () => {
    const none = await app().request('/api/postal-code/search?code=999-9999', {}, bindings);
    expect(((await none.json()) as { data: { status: string } }).data.status).toBe('none');
    const invalid = await app().request('/api/postal-code/search?code=abc', {}, bindings);
    const invalidBody = await invalid.json() as { data: { status: string; manualEntry: { preserved: boolean } } };
    expect(invalidBody.data.status).toBe('invalid');
    expect(invalidBody.data.manualEntry.preserved).toBe(true);
  });

  it('20件を超える候補を打ち切らず、totalに全件数を載せる', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      postalCode: '4520961', prefecture: '愛知県', city: '名古屋市千種区', town: `町${i}`,
    }));
    dbMocks.searchPostalCodes.mockResolvedValueOnce({ candidates: many, fromDb: true, total: many.length });
    const res = await app().request('/api/postal-code/search?code=452-0961', {}, bindings);
    const body = await res.json() as { data: { status: string; candidates: unknown[]; total: number } };
    expect(body.data.status).toBe('multiple');
    expect(body.data.candidates.length).toBe(25);
    expect(body.data.total).toBe(25);
  });

  it('未反映の環境を利用可能と偽らない', async () => {
    const res = await app().request('/api/postal-code/search?code=060-0000', {}, bindings);
    const body = await res.json() as { data: { normalized: string; readiness: { fullDataset: boolean } } };
    expect(body.data.normalized).toBe('0600000');
    expect(body.data.readiness.fullDataset).toBe(false);
  });
});
