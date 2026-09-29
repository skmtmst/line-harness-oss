import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

vi.mock('../middleware/role-guard.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/role-guard.js')>()),
}));

const { images } = await import('./images.js');

const get = vi.fn();

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { IMAGES: { get } } as unknown as Env['Bindings'];
    return next();
  });
  instance.route('/', images);
  return instance;
}

describe('公開画像配信の安全ヘッダ', () => {
  it('画像は nosniff を付け、そのまま表示する', async () => {
    get.mockResolvedValueOnce({
      body: 'PNGDATA',
      etag: 'etag-1',
      httpMetadata: { contentType: 'image/png' },
    });
    const res = await app().request('/images/abc.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toContain('inline');
  });

  it('画像以外は nosniff を付け、添付として渡す', async () => {
    get.mockResolvedValueOnce({
      body: 'PDFDATA',
      etag: 'etag-2',
      httpMetadata: { contentType: 'application/pdf' },
    });
    const res = await app().request('/images/media/doc.pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });
});
