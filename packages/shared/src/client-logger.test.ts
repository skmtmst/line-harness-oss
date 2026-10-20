import { afterEach, expect, it, vi } from 'vitest';
import { createClientLogger } from './client-logger.js';

afterEach(() => vi.restoreAllMocks());
it('ブラウザも同じ構造で記録し、例外と個人情報は出さず追跡番号だけを保つ', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const id = 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0';
  createClientLogger('liff').error('client.failure', Object.assign(new Error('secret-body'), { trackingId: id, email: 'customer@example.invalid' }));
  const text = String(log.mock.calls[0][0]);
  expect(JSON.parse(text)).toEqual({ timestamp: expect.any(String), level: 'error', code: 'client.failure', requestId: id, invocationId: null, source: 'liff' });
  expect(text).not.toMatch(/secret-body|customer@example/);
});
it('自由な追跡番号として個人情報を流さない', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  createClientLogger('admin').error('client.failure', { requestId: 'customer@example.invalid' });
  expect(JSON.parse(String(log.mock.calls[0][0])).requestId).toBeNull();
  expect(JSON.stringify(log.mock.calls)).not.toContain('customer@example');
});
