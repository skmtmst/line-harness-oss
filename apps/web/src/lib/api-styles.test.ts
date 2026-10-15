import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  fetchApi: vi
    .fn<(path: string, options?: RequestInit) => Promise<{ success: true }>>()
    .mockResolvedValue({ success: true }),
}));
vi.mock('./api', () => ({
  fetchApi: mocks.fetchApi,
  bookingApi: { listExceptions: vi.fn() },
}));
vi.mock('./restaurant-test-api', () => ({
  restaurantTestApi: { createClosure: vi.fn(), previewClosure: vi.fn() },
}));
import { styleApi } from './api-styles';
beforeEach(() => mocks.fetchApi.mockClear());
describe('style client scope and consent', () => {
  it('encodes account and staff IDs without changing the query scope', async () => {
    await styleApi.summary('a&account_id=b', {
      style: 'consult',
      view: 'tomorrow',
      staff_id: 's&other=x',
    });
    const path = mocks.fetchApi.mock.calls[0][0] as unknown as string;
    const url = new URL(path, 'https://example.test');
    expect(url.searchParams.getAll('account_id')).toEqual(['a&account_id=b']);
    expect(url.searchParams.get('staff_id')).toBe('s&other=x');
    expect(url.searchParams.get('view')).toBe('tomorrow');
  });
  it('preserves later/manual answers and sends explicit activation consent and draft identity', async () => {
    await styleApi.save('a', {
      expectedVersion: 2,
      answers: { booking: { mode: 'later' }, payment: { mode: 'manual' } },
    });
    expect(
      JSON.parse(
        (mocks.fetchApi.mock.calls[0][1] as unknown as RequestInit)
          .body as string,
      ),
    ).toMatchObject({
      answers: { booking: { mode: 'later' }, payment: { mode: 'manual' } },
    });
    await styleApi.activate('a', [
      { id: 'auto', kind: 'automation', expectedDraftVersionId: 'revision' },
    ]);
    expect(
      JSON.parse(
        (mocks.fetchApi.mock.calls[1][1] as unknown as RequestInit)
          .body as string,
      ),
    ).toMatchObject({
      confirmed: true,
      items: [{ id: 'auto', expectedDraftVersionId: 'revision' }],
    });
  });
  it('uses the existing analytics audience endpoint for booking results', async () => {
    await styleApi.createAudience('a', 'result/1', ['friend']);
    const [path, options] = mocks.fetchApi.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toContain(
      '/api/analytics/results/result%2F1/audiences?account_id=a',
    );
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      sourceKind: 'booking',
      friendIds: ['friend'],
    });
  });
});
