import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { normalizeApiFailure } from '../middleware/api-contract.js';
import { inputError } from '../lib/input-errors.js';
import { liffBookingInputError, liffBookingJson, liffBookingResponse } from './liff-booking-response.js';

describe('予約LIFFの応答の互換性', () => {
  it.each([
    [400, 'policy_acceptance_required'], [409, 'policy_changed'], [409, 'slot_conflict'],
    [409, 'hold_expired'], [409, 'card_not_registered'], [409, 'payment_not_connected'],
    [401, 'unauthorized'], [404, 'unknown_liff'], [422, 'invalid_starts_at'],
    [400, 'bookingId が必要です'], [404, '対象が見つかりません'], [500, 'booking_payment_unavailable'],
  ] as const)('HTTP %sの%sを、同じ本文と利用者向けの案内で返す', async (status, error) => {
    const app = new Hono();
    const old = { error, data: { version: 2 }, reason: '元の理由' };
    app.post('/', c => liffBookingJson(c, old, status));
    const response = await app.request('/', { method: 'POST' });
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body).toMatchObject({ ...old, success: false });
    expect(normalizeApiFailure(body, status, 'request')).toEqual(normalizeApiFailure(old, status, 'request'));
  });

  it.each([{ ok: true }, { available: false, reason: 'no_history' }, { booking_id: 'booking', payment_required: true, payment: { id: 'payment' } }])(
    '成功と空の結果の既存項目を残す: %j', async old => {
      const app = new Hono();
      app.get('/', c => liffBookingJson(c, old, 201));
      const response = await app.request('/');
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ ...old, success: true });
    },
  );

  it('入力欄の理由・明示したコードを残す', async () => {
    const app = new Hono();
    const payload = { error: 'invalid_starts_at', code: 'invalid_starts_at', data: { version: 2 } };
    app.post('/old', c => inputError(c, payload, 422, ['starts_at']));
    app.post('/new', c => liffBookingInputError(c, payload, 422, ['starts_at']));
    const old = await (await app.request('/old', { method: 'POST' })).json() as Record<string, unknown>;
    const body = await (await app.request('/new', { method: 'POST' })).json();
    expect(body).toEqual({ ...old, success: false });
  });

  it('共通の変更処理や保存済み応答の状態・ヘッダー・業務情報を残す', async () => {
    const app = new Hono();
    app.post('/', c => liffBookingResponse(c, new Response(JSON.stringify({ error: 'slot_conflict', alternatives: [] }), {
      status: 409, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Request-ID': 'request', 'ETag': 'old', 'Content-Length': '1' },
    })));
    const response = await app.request('/', { method: 'POST' });
    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Request-ID')).toBe('request');
    expect(response.headers.has('ETag')).toBe(false);
    expect(response.headers.has('Content-Length')).toBe(false);
    expect(await response.json()).toMatchObject({ success: false, error: 'slot_conflict', code: 'slot_conflict', alternatives: [] });
  });
});
