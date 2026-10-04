/*
 * 一覧の ETag/304（list-cache）。
 * 同じ中身なら304、変われば200。ETag に個人情報・秘密値は入れない。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getTags: vi.fn(),
  getTagsWithUsage: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: vi.fn(async () => ({
    allowedAccountIds: ['account-a'],
    canSeeUnassigned: true,
  })),
}));

const { tags } = await import('./tags.js');

const SECRET = 'secret-token-xyz-123';
const TAG_ROW = (id: string, name: string) => ({
  id,
  name,
  color: '#3B82F6',
  group_id: null,
  line_account_id: 'account-a',
  note: SECRET,
  created_at: '2026-10-01',
  updated_at: '2026-10-01',
});

function app() {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.route('/', tags);
  return instance;
}

const get = (headers: Record<string, string> = {}) =>
  app().request('/api/tags', { headers }, { DB: {} as D1Database });

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getTags.mockResolvedValue([TAG_ROW('tag-1', 'VIP')]);
  dbMocks.getTagsWithUsage.mockResolvedValue([]);
});

describe('一覧のETag', () => {
  it('同じ中身なら304を返す', async () => {
    const first = await get();
    expect(first.status).toBe(200);
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();
    const second = await get({ 'If-None-Match': etag ?? '' });
    expect(second.status).toBe(304);
  });

  it('中身が変われば200でETagも変わる', async () => {
    const first = await get();
    const etag = first.headers.get('ETag') ?? '';
    dbMocks.getTags.mockResolvedValue([TAG_ROW('tag-1', 'VIP'), TAG_ROW('tag-2', '新規')]);
    const second = await get({ 'If-None-Match': etag });
    expect(second.status).toBe(200);
    expect(second.headers.get('ETag')).not.toBe(etag);
  });

  it('ETagに個人情報・秘密値を入れない', async () => {
    const first = await get();
    const etag = first.headers.get('ETag') ?? '';
    expect(etag).not.toContain(SECRET);
    expect(etag).not.toContain('VIP');
  });
});
