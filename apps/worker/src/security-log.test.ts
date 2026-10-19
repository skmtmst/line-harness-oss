import { expect, it, vi } from 'vitest';
import worker from './index.js';
import type { Env } from './worker-env.js';

it('S14 unhandled errors log a code and route template without request identifiers or exception details', async () => {
  const marker='SYNTHETIC_PRIVATE_MARKER';
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    const response=await worker.fetch(new Request(`http://localhost/api/line-accounts/synthetic-private-id?token=${marker}`,{headers:{Authorization:'Bearer synthetic-env-key'}}),{
      API_KEY:'synthetic-env-key',DB:{prepare:()=>{throw new Error(`provider token=${marker}`);}},
    } as unknown as Env['Bindings'], { waitUntil:()=>{},passThroughOnException:()=>{}, props: {} } as ExecutionContext);
    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalled();
    const output=JSON.stringify(log.mock.calls);
    expect(output).not.toContain(marker);expect(output).not.toContain('synthetic-private-id');
    expect(output).toContain('code');
  } finally {log.mockRestore();}
});

it('S14 also protects HTML returned by the Worker assets fallback', async () => {
  const asset = new Response('<!doctype html><title>Synthetic</title>', { headers: { 'content-type': 'text/html' } });
  Object.defineProperty(asset.headers, 'set', { value: () => { throw new TypeError('immutable asset headers'); } });
  const response = await worker.fetch(new Request('http://localhost/synthetic-customer-entry', { headers: { accept: 'text/html' } }), {
    ASSETS: { fetch: async () => asset },
  } as unknown as Env['Bindings'], { waitUntil:()=>{},passThroughOnException:()=>{}, props: {} } as ExecutionContext);
  expect(response.status).toBe(200);
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
  expect(response.headers.get('Content-Security-Policy-Report-Only')).toContain('https://static.line-scdn.net');
});
