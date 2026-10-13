import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { images } from './images.js';
vi.mock('../services/account-access.js', () => ({ getVisibleLineAccountScope: async () => ({ ids: ['synthetic-account'] }), canAccessAllLineAccounts: async () => true }));
vi.mock('../services/file-scan.js', () => ({ builtinFileScan: () => ({ verdict: 'clean' }), checkKeyGate: () => ({ allowed: true }) }));

const maxBytes = 10 * 1024 * 1024;
function app(put: ReturnType<typeof vi.fn>) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => { c.set('staff', { id: 'synthetic-staff', name: 'Synthetic', role: 'admin', readOnly: false }); await next(); });
  instance.route('/', images);
  return { instance, env: { IMAGES: { put }, DB: {} } as unknown as Env['Bindings'] };
}
describe('S13 image size before allocation', () => {
  it('rejects an oversized declared binary body before arrayBuffer or storage', async () => {
    const put = vi.fn(); const { instance, env } = app(put);
    const request = new Request('http://localhost/api/images', { method:'POST', headers: { 'content-type':'image/png', 'content-length':String(maxBytes+1) }, body:new Uint8Array(1) });
    const read = vi.spyOn(request, 'arrayBuffer');
    expect((await instance.request(request, undefined, env)).status).toBe(413);
    expect(read).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
  it('rejects oversized JSON before parsing base64', async () => {
    const put = vi.fn(); const { instance, env } = app(put);
    const request=new Request('http://localhost/api/images', { method:'POST', headers:{ 'content-type':'application/json', 'content-length':String(Math.ceil(maxBytes/3)*4+4097) },body:'{}' });
    const read = vi.spyOn(request, 'json');
    expect((await instance.request(request, undefined, env)).status).toBe(413);
    expect(read).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
  });
  it('stops a stream without Content-Length as soon as it exceeds the binary budget', async () => {
    const put=vi.fn();const { instance, env }=app(put);let pulls=0;let canceled=false;
    const stream=new ReadableStream<Uint8Array>({ pull(controller) { pulls++;controller.enqueue(new Uint8Array(2*1024*1024));if(pulls===8)controller.close(); },cancel(){canceled=true;} });
    const request=new Request('http://localhost/api/images',{ method:'POST',headers:{'content-type':'image/png'},body:stream,duplex:'half' } as RequestInit);
    expect((await instance.request(request,undefined,env)).status).toBe(413);
    expect(pulls).toBeLessThan(8);expect(canceled).toBe(true);expect(put).not.toHaveBeenCalled();
  });
  it('keeps normal base64 image uploads usable', async () => {
    const put=vi.fn();const { instance,env }=app(put);
    const res=await instance.request('/api/images',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:btoa('synthetic-image'),mimeType:'image/png'})},env);
    expect(res.status).toBe(201);expect(put).toHaveBeenCalledOnce();
  });
});
