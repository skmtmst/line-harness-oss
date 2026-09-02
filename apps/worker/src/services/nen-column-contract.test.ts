import { describe, expect, it } from 'vitest';
import {
  buildNenColumnStorageFields,
  isNenColumnSlugConflict,
  readBoundedJsonObject,
  slugFromArticleUrl,
  validateNenColumnCreateBody,
} from './nen-column-contract.js';

describe('NEN column create contract', () => {
  it('reads a bounded JSON object', async () => {
    const request = new Request('https://worker.example/api', {
      method: 'POST',
      body: JSON.stringify({ title: '記事' }),
      headers: { 'content-type': 'application/json' },
    });
    await expect(readBoundedJsonObject(request)).resolves.toEqual({
      ok: true,
      value: { title: '記事' },
    });
  });

  it('rejects malformed, non-object, and oversized JSON before validation', async () => {
    const malformed = new Request('https://worker.example/api', { method: 'POST', body: '{' });
    expect(await readBoundedJsonObject(malformed)).toMatchObject({ status: 400, error: 'request_invalid' });

    const array = new Request('https://worker.example/api', { method: 'POST', body: '[]' });
    expect(await readBoundedJsonObject(array)).toMatchObject({ status: 400, error: 'request_invalid' });

    const oversized = new Request('https://worker.example/api', {
      method: 'POST',
      body: JSON.stringify({ title: 'x'.repeat(17_000) }),
    });
    expect(await readBoundedJsonObject(oversized)).toMatchObject({ status: 413, error: 'payload_too_large' });
  });

  it('normalizes the six allowed fields and derives a case-preserving slug', () => {
    expect(validateNenColumnCreateBody({
      title: '  鹿肉の選び方  ',
      category: '  食事  ',
      excerpt: '  原材料表示の基本  ',
      articleUrl: 'https://example.com/columns/NEN%2DGuide/',
      imageUrl: 'https://cdn.example.com/guide.jpg',
      publishedAt: '2026-08-31T10:30:00+09:00',
    })).toEqual({
      ok: true,
      value: {
        title: '鹿肉の選び方',
        category: '食事',
        excerpt: '原材料表示の基本',
        articleUrl: 'https://example.com/columns/NEN%2DGuide/',
        imageUrl: 'https://cdn.example.com/guide.jpg',
        publishedAt: '2026-08-31T01:30:00.000Z',
        slug: 'NEN-Guide',
      },
    });
  });

  it('keeps omitted publication and image values null instead of inventing them', () => {
    const result = validateNenColumnCreateBody({
      title: '下書き',
      articleUrl: 'https://example.com/columns/draft',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { category: null, excerpt: '', imageUrl: null, publishedAt: null, slug: 'draft' },
    });
  });

  it.each(['body', 'slug', 'externalId', 'lineAccountId'])(
    'rejects the forbidden %s field',
    (field) => {
      expect(validateNenColumnCreateBody({
        title: '記事',
        articleUrl: 'https://example.com/columns/article',
        [field]: 'hidden-value',
      })).toEqual({ ok: false, error: 'request_invalid' });
    },
  );

  it.each([
    ['title_invalid', { title: ' ', articleUrl: 'https://example.com/columns/article' }],
    ['title_invalid', { title: 'x'.repeat(121), articleUrl: 'https://example.com/columns/article' }],
    ['category_too_long', { title: '記事', category: 'x'.repeat(61), articleUrl: 'https://example.com/columns/article' }],
    ['excerpt_too_long', { title: '記事', excerpt: 'x'.repeat(501), articleUrl: 'https://example.com/columns/article' }],
    ['article_url_invalid', { title: '記事', articleUrl: 'http://example.com/columns/article' }],
    ['article_url_invalid', { title: '記事', articleUrl: 'https://user:pass@example.com/columns/article' }],
    ['image_url_invalid', { title: '記事', articleUrl: 'https://example.com/columns/article', imageUrl: 'http://example.com/a.jpg' }],
    ['published_at_invalid', { title: '記事', articleUrl: 'https://example.com/columns/article', publishedAt: '2026-08-31 10:30:00' }],
  ])('returns %s for an invalid field', (error, body) => {
    expect(validateNenColumnCreateBody(body)).toEqual({ ok: false, error });
  });

  it.each([
    ['https://example.com/', null],
    ['https://example.com/columns/.', null],
    ['https://example.com/columns/%2E%2E', null],
    ['https://example.com/columns/a%2Fb', null],
    ['https://example.com?next=/columns/query-is-not-a-path', null],
    [`https://example.com/columns/${'x'.repeat(161)}`, null],
    ['https://example.com/columns/valid', 'valid'],
  ])('derives a safe slug from %s', (url, expected) => {
    expect(slugFromArticleUrl(url)).toBe(expected);
  });

  it('builds the same saved intro fields for admin and signed integrations', () => {
    expect(buildNenColumnStorageFields({
      title: '鹿肉の選び方', category: null, excerpt: '原材料表示の基本',
      articleUrl: 'https://example.com/columns/article', imageUrl: null, publishedAt: null,
    })).toMatchObject({
      title: '鹿肉の選び方',
      excerpt: '原材料表示の基本',
      introText: expect.stringContaining('鹿肉の選び方'),
    });
  });

  it('recognizes only the slug unique constraint as a duplicate', () => {
    expect(isNenColumnSlugConflict(new Error('D1_ERROR: UNIQUE constraint failed: nen_columns.slug'))).toBe(true);
    expect(isNenColumnSlugConflict(new Error('D1_ERROR: no such table: nen_columns'))).toBe(false);
  });
});
