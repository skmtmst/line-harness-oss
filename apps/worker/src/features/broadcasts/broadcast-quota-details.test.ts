import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchQuotaDetails, fetchQuota } from './broadcast-quota-guard.js';
afterEach(() => vi.unstubAllGlobals());
describe('送信枠を確認できない理由', () => {
  it.each([401,403,429,500])('外部が%sを返しても秘密値や応答本文を理由へ含めない', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private-provider-body',{status})));
    const result=await fetchQuotaDetails('private-channel-token');
    expect(result.limit).toBeNull();expect(result.used).toBeNull();
    expect(result.failures.map(f=>f.endpoint)).toEqual(['quota','consumption']);
    expect(result.failures.every(f=>f.code===(status===401||status===403?'authentication':status===429?'rate_limit':'unavailable'))).toBe(true);
    expect(result.reason).toBeTruthy();expect(JSON.stringify(result)).not.toMatch(/private/);
    expect(await fetchQuota('private-channel-token')).toEqual({limit:null,used:null});
  });
  it('未接続はLINEへ問い合わせず接続設定へ案内する', async () => {
    const request=vi.fn();vi.stubGlobal('fetch',request);
    expect(await fetchQuotaDetails('')).toMatchObject({limit:null,used:null,reason:expect.stringContaining('接続設定')});
    expect(request).not.toHaveBeenCalled();
  });
  it('上限の未設定と取得失敗を区別する', async () => {
    vi.stubGlobal('fetch',vi.fn(async input=>new Response(JSON.stringify(String(input).endsWith('/consumption')?{totalUsage:20}:{type:'none'}))));
    expect(await fetchQuotaDetails('token')).toEqual({limit:null,used:20,unlimited:true,failures:[],reason:null});
  });
  it('片方だけの不正な応答は、失敗した問い合わせ先を残す', async () => {
    vi.stubGlobal('fetch',vi.fn(async input=>new Response(JSON.stringify(String(input).endsWith('/consumption')?{totalUsage:-1}:{type:'limited',value:200}))));
    expect(await fetchQuotaDetails('token')).toMatchObject({limit:200,used:null,failures:[{endpoint:'consumption',code:'invalid_response'}]});
  });
});
