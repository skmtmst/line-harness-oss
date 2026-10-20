import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from './turnstile.js';
const environment={TURNSTILE_SECRET_KEY:'fixture-turnstile-secret'};
describe('robot verification requires a real positive provider result and fails closed',()=>{
 it('posts the token to the expected provider without putting it in a URL',async()=>{
  const network=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({success:true}));
  expect(await verifyTurnstile(environment,'fixture-token','203.0.113.1',network)).toEqual({ok:true});
  const [url,init]=network.mock.calls[0];expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  expect(init?.method).toBe('POST');const body=new URLSearchParams(String(init?.body));
  expect(body.get('response')).toBe('fixture-token');expect(body.get('secret')).toBe(environment.TURNSTILE_SECRET_KEY);expect(body.get('remoteip')).toBe('203.0.113.1');
 });
 it('never contacts the provider without configuration or a bounded token',async()=>{
  const network=vi.fn(async()=>Response.json({success:true}));
  expect(await verifyTurnstile({},'fixture-token',null,network)).toEqual({ok:false,reason:'not_configured'});
  for(const token of [undefined,'','x'.repeat(2049)])expect(await verifyTurnstile(environment,token,null,network)).toEqual({ok:false,reason:'missing_token'});
  expect(network).not.toHaveBeenCalled();
 });
 it.each([false,'true',null])('rejects success=%s',async success=>{
  expect(await verifyTurnstile(environment,'fixture-token',null,async()=>Response.json({success}))).toEqual({ok:false,reason:'rejected'});
 });
 it('rejects HTTP and transport errors without returning provider error text',async()=>{
  const failed=await verifyTurnstile(environment,'fixture-token',null,async()=>new Response('fixture-provider-error',{status:503}));
  const thrown=await verifyTurnstile(environment,'fixture-token',null,async()=>{throw new Error('fixture-private-provider-error');});
  expect(failed).toEqual({ok:false,reason:'unavailable'});expect(thrown).toEqual(failed);expect(JSON.stringify(thrown)).not.toContain('fixture-private');
 });
});
