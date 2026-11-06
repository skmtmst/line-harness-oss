import { afterEach, expect, it, vi } from 'vitest';
import plugin, { type Env } from '../src/index.js';

const env: Env = { LINE_HARNESS_API_URL: 'https://example.invalid', LINE_HARNESS_API_KEY: 'test', EXTERNAL_API_KEY: 'test' };
afterEach(() => vi.restoreAllMocks());

it('未実装の署名検証を通った扱いにせず、本文を読まず外部呼び出しもせずに止める', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not call'));
  const request = new Request('https://plugin.invalid/webhook', { method: 'POST', body: 'private customer payload' });
  const json = vi.spyOn(request, 'json');
  const response = await plugin.fetch(request, env, {} as ExecutionContext);
  expect(response.status).toBe(501);
  expect(await response.json()).toEqual({ error: 'Webhook integration is not configured' });
  expect(json).not.toHaveBeenCalled();
  expect(request.bodyUsed).toBe(false);
  expect(log).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('healthと未定義経路の応答を保つ', async () => {
  expect((await plugin.fetch(new Request('https://plugin.invalid/health'), env, {} as ExecutionContext)).status).toBe(200);
  expect((await plugin.fetch(new Request('https://plugin.invalid/elsewhere'), env, {} as ExecutionContext)).status).toBe(404);
});
