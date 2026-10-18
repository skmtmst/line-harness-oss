import { afterEach, expect, it, vi } from 'vitest';
import { boundedHttpRequest } from './bounded-http.js';
import { stripeRequest } from '../../services/stripe-api.js';
import { currentRequestId, withInvocation } from '@line-crm/shared/server';
afterEach(()=>vi.useRealTimers());
it('passes the server request ID through bounded Stripe and Google transports without changing wire safety', async () => {
 await withInvocation('http', async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ id: 'synthetic' }));
  await boundedHttpRequest('https://provider.test', { headers: { Authorization: 'synthetic', 'X-Request-ID': 'untrusted' } }, { timeoutMs: 100, maxResponseBytes: 100, fetch: send });
  await stripeRequest({ STRIPE_SECRET_KEY: 'synthetic' }, 'POST', '/v1/customers', {}, { fetchImpl: send, idempotencyKey: 'same-operation' });
  const { GoogleCalendarClient } = await import('../../services/google-calendar.js');
  await new GoogleCalendarClient({ calendarId: 'synthetic', accessToken: 'synthetic', transport: send }).getEvent('synthetic-event');
  expect(send).toHaveBeenCalledTimes(3);
  for (const [, init] of send.mock.calls) {
   expect(new Headers(init?.headers).get('X-Request-ID')).toBe(currentRequestId());
   expect(init?.redirect).toBe('manual');
   expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
  expect(new Headers(send.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBe('same-operation');
 });
});
it('bounds a stalled request even when the transport ignores abort',async()=>{
 vi.useFakeTimers();const send=vi.fn<typeof fetch>(()=>new Promise<Response>(()=>{}));
 const result=boundedHttpRequest('https://provider.test',{}, {timeoutMs:10,maxResponseBytes:10,fetch:send});
 const rejected=expect(result).rejects.toThrow('external_request_interrupted');
 await vi.advanceTimersByTimeAsync(10);await rejected;expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});
it('includes stalled body consumption in the timeout and cancels its reader',async()=>{
 vi.useFakeTimers();const cancel=vi.fn();
 const send=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel})));
 const result=boundedHttpRequest('https://provider.test',{}, {timeoutMs:10,maxResponseBytes:10,fetch:send});
 const rejected=expect(result).rejects.toThrow();await vi.advanceTimersByTimeAsync(10);await rejected;
 expect(cancel).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledOnce();
});
it('caps streamed bytes before parsing, cancels the stream and never retries',async()=>{
 const cancel=vi.fn();const send=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(11));},cancel})));
 await expect(boundedHttpRequest('https://provider.test',{}, {timeoutMs:100,maxResponseBytes:10,fetch:send})).rejects.toThrow('external_response_too_large');
 expect(cancel).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledOnce();
});
it('marks a Stripe mutation whose response is lost as unknown without a second request',async()=>{
 const send=vi.fn(async()=>{throw new Error('lost response')});
 await expect(stripeRequest({STRIPE_SECRET_KEY:'synthetic'},'POST','/v1/customers',{}, {fetchImpl:send})).rejects.toMatchObject({resultUnknown:true});
 expect(send).toHaveBeenCalledOnce();
});
it('keeps a Stripe 5xx mutation unknown and performs no automatic retry',async()=>{
 const send=vi.fn(async()=>Response.json({error:{code:'temporary'}},{status:503}));
 await expect(stripeRequest({STRIPE_SECRET_KEY:'synthetic'},'POST','/v1/customers',{}, {fetchImpl:send})).rejects.toMatchObject({status:503,resultUnknown:true});
 expect(send).toHaveBeenCalledOnce();
});
it('keeps the Stripe adapter connected to the deadline, including a stalled provider',async()=>{
 vi.useFakeTimers();const send=vi.fn<typeof fetch>(()=>new Promise<Response>(()=>{}));
 const result=stripeRequest({STRIPE_SECRET_KEY:'synthetic'},'POST','/v1/customers',{}, {fetchImpl:send});
 const rejected=expect(result).rejects.toMatchObject({status:502,resultUnknown:true});
 await vi.advanceTimersByTimeAsync(10_000);await rejected;expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});
it('keeps the Stripe adapter connected to the streamed response byte limit',async()=>{
 const cancel=vi.fn();const send=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1024*1024+1));},cancel})));
 await expect(stripeRequest({STRIPE_SECRET_KEY:'synthetic'},'POST','/v1/customers',{}, {fetchImpl:send})).rejects.toMatchObject({status:502,resultUnknown:true});
 expect(send).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();
});

it('keeps the Stripe caller cancellation connected without raising its own deadline',async()=>{
 const controller=new AbortController();const send=vi.fn<typeof fetch>(()=>new Promise<Response>(()=>{}));
 const result=stripeRequest({STRIPE_SECRET_KEY:'synthetic'},'POST','/v1/customers',{}, {fetchImpl:send,signal:controller.signal});
 const rejected=expect(result).rejects.toMatchObject({resultUnknown:true});controller.abort();await rejected;
 expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it('keeps Google connected to the streamed byte limit and never retries inside its transport',async()=>{
 const {GoogleCalendarClient}=await import('../../services/google-calendar.js');const cancel=vi.fn();
 const send=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1024*1024+1));},cancel})));
 const client=new GoogleCalendarClient({calendarId:'synthetic',accessToken:'synthetic',transport:send});
 await expect(client.getEvent('synthetic-event')).rejects.toThrow('external_response_too_large');
 expect(send).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();
});

it('bounds a stalled Google response body even when its transport ignores abort',async()=>{
 vi.useFakeTimers();const {GoogleCalendarClient}=await import('../../services/google-calendar.js');const cancel=vi.fn();
 const send=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel})));
 const client=new GoogleCalendarClient({calendarId:'synthetic',accessToken:'synthetic',transport:send});
 const result=client.getEvent('synthetic-event');const rejected=expect(result).rejects.toThrow('external_request_interrupted');
 await vi.advanceTimersByTimeAsync(10_000);await rejected;
 expect(send).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();
});
