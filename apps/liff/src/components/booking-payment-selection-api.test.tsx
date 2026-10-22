// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../lib/api.js';
import Confirm from './confirm.js';

vi.mock('../lib/liff-auth.js', () => ({ getLiffId: () => 'liff-a', getIdToken: () => 'token' }));
const menu = { id: 'menu', name: 'カット', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 8400, sort_order: 0, payment_mode: 'customer_choice' as const };
const staff = { id: 'staff', display_name: '担当', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 8400, duration_minutes: 60 };
const estimate = (payment?: unknown) => ({ success: true, data: {
  cancellation: { enabled: false, version: 0, price: 8400, tiers: [{ beforeHours: 24, percent: 0 }, { beforeHours: 0, percent: 50 }], noShowPercent: 100, freeUntil: null, cardRequired: false },
  deposit: { amount: 0 }, ...(payment === undefined ? {} : { payment }),
} });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('本物のAPI関数で選択条件を読み、本人が選んだ方法だけを認証・予約キーと共に送る', async () => {
  const requests: Array<{ body: unknown; init: RequestInit | undefined }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.searchParams.get('liffId')).toBe('liff-a'); expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });
    if (url.pathname.endsWith('/cost-estimate')) return Response.json(estimate({ mode: 'customer_choice', allowedMethods: ['online', 'onsite'] }));
    if (url.pathname.endsWith('/entitlements')) return Response.json({ success: true, data: [] });
    if (url.pathname.endsWith('/requests')) {
      requests.push({ body: JSON.parse(String(init?.body)), init });
      return Response.json({ booking_id: 'booking', status: 'requested', payment_required: true, payment: { id: 'payment', status: 'pending', holdUntil: '2099-01-01T01:10:00Z' } }, { status: 201 });
    }
    throw Error('unexpected_external_request');
  }));
  const onSubmitted = vi.fn();
  render(<Confirm menu={menu} staff={staff} slot={{ date: '2099-01-01', start: '10:00' }} autoConfirm onSubmitted={onSubmitted} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'オンラインで先に払う' }));
  fireEvent.click(screen.getByRole('button', { name: 'この内容で予約をリクエストする' }));
  await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'booking', payment: expect.objectContaining({ id: 'payment' }) })));
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toEqual({ menu_id: 'menu', staff_id: 'staff', starts_at: '2099-01-01T01:00:00.000Z', payment_method: 'online' });
  expect(requests[0].init?.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) });
});

it.each([
  { mode: 'customer_choice', allowedMethods: ['onsite'] },
  { mode: 'customer_choice', allowedMethods: ['online', 'online'] },
  { mode: 'customer_choice', allowedMethods: ['card'] },
  { mode: 'none', allowedMethods: ['online'] },
  { mode: 'online', allowedMethods: ['onsite'] },
  null,
])('不正な選択条件%jを無視して予約できる状態へ戻さない', async payment => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(estimate(payment))));
  await expect(api.cancellationPreview({ menuId: 'menu', staffId: 'staff', startsAt: '2099-01-01T01:00:00Z' })).rejects.toThrow('応答の形が違います');
});

it('古いWorkerで選択条件が欠ける場合は欠測のまま返し、選択なしとは判定しない', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(estimate())));
  const result = await api.cancellationPreview({ menuId: 'menu', staffId: 'staff', startsAt: '2099-01-01T01:00:00Z' });
  expect(result).not.toHaveProperty('payment'); expect(result.enabled).toBe(false);
});
