import { afterEach, describe, expect, it, vi } from 'vitest';
import { responseLiffError } from './api-error.js';
import { decideFormSubmitStep } from './form-submit-flow.js';
import { legacyApiErrorBody, readApiError } from '@line-crm/shared';
import { errorCode } from '../pages/booking-history-messages.js';

vi.mock('./liff-auth.js', () => ({ getIdToken: () => 'fixture-token', getLiffId: () => 'fixture-liff' }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const id = 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0';
const body = (code: string) => ({ success: false, error: { code, message: '内容を確認してください。', requestId: id,
  fieldErrors: [{ field: 'name', message: '名前を入力してください。' }] } });

describe('LIFFの共通失敗契約', () => {
  it('本人の予約変更・取消のコード分岐と追跡・項目の理由を保つ', async () => {
    const error = await responseLiffError(new Response(JSON.stringify(body('self_deadline_passed')), { status: 409 }));
    expect(errorCode(error)).toBe('self_deadline_passed');
    expect(error).toMatchObject({ status: 409, code: 'self_deadline_passed', requestId: id, message: '内容を確認してください。', fields: { name: '名前を入力してください。' } });
  });
  it('フォームの内容不一致では新しいキーを作る自動再送へ進めない', () => {
    const raw = body('idempotency_content_mismatch');
    const normalized = { ...legacyApiErrorBody(raw) as object, error: readApiError(raw).message };
    expect(decideFormSubmitStep({ status: 409, body: normalized })).toEqual({ action: 'conflict', code: 'idempotency_content_mismatch' });
  });
  it('プロキシの本文・HTML・内部の例外を利用者の文言へ混ぜない', async () => {
    const error = await responseLiffError(new Response('<html>Bearer secret</html>', { status: 503, headers: { 'X-Request-ID': id } }));
    expect(error).toMatchObject({ status: 503, requestId: id });
    expect(error.message).not.toMatch(/secret|html/);
  });
});

it('実際のフォーム通信境界を通しても、409は新しい回答として送り直さない', async () => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  const transport = vi.fn(async () => new Response(JSON.stringify(body('idempotency_content_mismatch')), { status: 409 }));
  vi.stubGlobal('fetch', transport);
  const { api } = await import('./api.js');
  const result = await api.submitForm('fixture-form', { data: { name: 'fixture' } }, id);
  expect(result.status).toBe(409);
  expect(result.body).toMatchObject({ code: 'idempotency_content_mismatch', requestId: id, fields: { name: '名前を入力してください。' }, error: '内容を確認してください。' });
  expect(decideFormSubmitStep(result)).toEqual({ action: 'conflict', code: 'idempotency_content_mismatch' });
  expect(transport).toHaveBeenCalledTimes(1);
});
