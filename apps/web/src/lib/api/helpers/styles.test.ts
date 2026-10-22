import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  fetchApi: vi
    .fn<(path: string, options?: RequestInit) => Promise<{ success: true }>>()
    .mockResolvedValue({ success: true }),
}));
vi.mock('../../api', () => ({
  fetchApi: mocks.fetchApi,
  bookingApi: { listExceptions: vi.fn() },
}));
vi.mock('../../restaurant-test-api', () => ({
  restaurantTestApi: { createClosure: vi.fn(), previewClosure: vi.fn() },
}));
import { styleApi, hqStyleApi } from './styles';
beforeEach(() => mocks.fetchApi.mockClear());
describe('style client scope and consent', () => {
  it('uses the same sample catalog for accounts and HQ and sends day/week/month schedule conditions', async () => {
    await styleApi.templateSamples('a', 'lesson');
    await hqStyleApi.templateSamples('lesson');
    expect(mocks.fetchApi.mock.calls[0][0]).toBe(
      '/api/dashboard/style/template-samples?account_id=a&style=lesson',
    );
    expect(mocks.fetchApi.mock.calls[1][0]).toBe(
      '/api/hq/style-template-samples?style=lesson',
    );
    await styleApi.schedule('a', {
      style: 'salon',
      range: 'month',
      date: '2026-10-15',
      display: 'calendar',
      calendar_view: 'month',
      staff_id: 's',
    });
    const params = new URL(
      mocks.fetchApi.mock.calls[2][0],
      'https://example.test',
    ).searchParams;
    expect(params.get('range')).toBe('month');
    expect(params.get('calendar_view')).toBe('month');
    expect(params.get('display')).toBe('calendar');
    expect(params.get('staff_id')).toBe('s');
  });
  it('sends style deferral and the HQ automatic insertion preference with versions', async () => {
    await styleApi.save('a', {
      expectedVersion: 2,
      styleMode: 'later',
      answers: {
        cancelDeadline: { mode: 'manual' },
        hours: { mode: 'later' },
        partySize: { mode: 'configured', value: '1-6' },
      },
    });
    expect(
      JSON.parse(mocks.fetchApi.mock.calls[0][1]!.body as string),
    ).toMatchObject({
      expectedVersion: 2,
      styleMode: 'later',
      answers: { cancelDeadline: { mode: 'manual' }, hours: { mode: 'later' } },
    });
    await hqStyleApi.saveStarterSet('restaurant', {
      expectedVersion: 3,
      name: '飲食',
      autoInsert: false,
      definition: { items: [] },
    });
    expect(mocks.fetchApi.mock.calls[1][0]).toBe(
      '/api/hq/style-starter-sets/restaurant',
    );
    expect(
      JSON.parse(mocks.fetchApi.mock.calls[1][1]!.body as string),
    ).toMatchObject({ expectedVersion: 3, autoInsert: false });
  });
  it('encodes account and staff IDs without changing the query scope', async () => {
    await styleApi.summary('a&account_id=b', {
      style: 'consult',
      range: 'week',
      staff_id: 's&other=x',
    });
    const path = mocks.fetchApi.mock.calls[0][0] as unknown as string;
    const url = new URL(path, 'https://example.test');
    expect(url.searchParams.getAll('account_id')).toEqual(['a&account_id=b']);
    expect(url.searchParams.get('staff_id')).toBe('s&other=x');
    expect(url.searchParams.get('range')).toBe('week');
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

it('preflights a distribution and sends the reviewed token, copy policy and shop consent', async () => {
  await hqStyleApi.preflight('salon', {
    expectedVersion: 4,
    target: { style: 'salon' },
  });
  await hqStyleApi.distribute('salon', {
    expectedVersion: 4,
    target: { accountIds: ['a'] },
    token: 'reviewed-token',
    confirmed: true,
    editedAction: 'notify',
  });
  await styleApi.acceptStarterUpdate('a', 'welcome', {
    confirmed: true,
    expectedSetVersion: 4,
    expectedSnapshot: 'snapshot',
  });
  expect(mocks.fetchApi.mock.calls.map((c) => c[0])).toEqual([
    '/api/hq/style-starter-sets/salon/preflight',
    '/api/hq/style-starter-sets/salon/distribute',
    '/api/dashboard/style/starter-items/welcome/accept-update?account_id=a',
  ]);
  expect(
    JSON.parse(mocks.fetchApi.mock.calls[1][1]!.body as string),
  ).toMatchObject({
    token: 'reviewed-token',
    confirmed: true,
    editedAction: 'notify',
    target: { accountIds: ['a'] },
  });
});
it('saves KPI choices and reminder draft revision without losing account/version scoping', async () => {
  await styleApi.saveCards(
    'a',
    7,
    [{ id: 'analytics', visible: false }],
    ['bookings', 'paidAmount'],
  );
  await styleApi.activate('a', [
    { id: 'reminder', kind: 'reminder', expectedDraftVersionId: 'draft' },
  ]);
  expect(JSON.parse(mocks.fetchApi.mock.calls[0][1]!.body as string)).toEqual({
    expectedVersion: 7,
    cards: [{ id: 'analytics', visible: false }],
    metricIds: ['bookings', 'paidAmount'],
  });
  expect(JSON.parse(mocks.fetchApi.mock.calls[1][1]!.body as string)).toEqual({
    confirmed: true,
    items: [
      { id: 'reminder', kind: 'reminder', expectedDraftVersionId: 'draft' },
    ],
  });
});
it('omits metricIds from a cards-only save and keeps an explicit empty metric selection', async () => {
  await styleApi.saveCards('a', 3, [{ id: 'analytics', visible: false }]);
  expect(JSON.parse(mocks.fetchApi.mock.calls[0][1]!.body as string)).toEqual({ expectedVersion: 3, cards: [{ id: 'analytics', visible: false }] });
  await styleApi.saveCards('a', 4, [], []);
  expect(JSON.parse(mocks.fetchApi.mock.calls[1][1]!.body as string)).toEqual({ expectedVersion: 4, cards: [], metricIds: [] });
});
