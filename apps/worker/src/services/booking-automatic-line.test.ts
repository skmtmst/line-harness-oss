import { describe, expect, it, vi, beforeEach } from 'vitest';
const mocks=vi.hoisted(()=>({stopped:vi.fn(),feature:vi.fn(),proxy:vi.fn(),credential:vi.fn()}));
vi.mock('@line-crm/db',async()=>({...await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db'),isOperationCapabilityStopped:mocks.stopped,resolveLineCredential:mocks.credential}));
vi.mock('./feature-enforcement.js',()=>({featureJobCanRun:mocks.feature}));
vi.mock('./line-proxy-send.js',()=>({pushViaHarnessProxy:mocks.proxy}));
vi.mock('./local-line-proxy.js',()=>({dispatchLineProxyLocally:vi.fn()}));
import { sendAutomaticBookingLine } from './booking-automatic-line.js';
import type { Env } from '../index.js';
const env={DB:{prepare:()=>({bind:()=>({first:async()=>({channel_access_token:'試験専用',channel_access_token_encrypted:null})})})},WORKER_URL:'https://worker.example.test'} as unknown as Env['Bindings'];
const input={accountId:'account',to:'試験の宛先',text:'試験の通知',retryKey:'retry',featureId:'booking' as const};
beforeEach(()=>{vi.clearAllMocks();mocks.stopped.mockResolvedValue(false);mocks.feature.mockResolvedValue(true);mocks.credential.mockResolvedValue('試験専用');mocks.proxy.mockResolvedValue({});});
describe('予約の自動LINE通知',()=>{
 it('送信停止中は実送信しない',async()=>{mocks.stopped.mockResolvedValue(true);expect(await sendAutomaticBookingLine(env,input)).toBe(false);expect(mocks.proxy).not.toHaveBeenCalled();});
 it('機能停止中は実送信しない',async()=>{mocks.feature.mockResolvedValue(false);expect(await sendAutomaticBookingLine(env,input)).toBe(false);expect(mocks.proxy).not.toHaveBeenCalled();});
 it('同じ再試行キーを使ってHarnessへ送り、手動送信の引数を追加しない',async()=>{
  expect(await sendAutomaticBookingLine(env,input)).toBe(true);
  expect(mocks.proxy).toHaveBeenCalledWith(env.WORKER_URL,'試験専用',input.to,[{type:'text',text:input.text}],'retry',expect.any(Function));
 });
});
