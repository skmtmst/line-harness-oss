import { afterEach, expect, it, vi } from 'vitest';
import { boundedHttpRequest } from './bounded-http.js';
import { stripeRequest } from '../../services/stripe-api.js';
afterEach(()=>vi.useRealTimers());
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
