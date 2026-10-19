// @vitest-environment happy-dom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';

const f=vi.hoisted(()=>({runs:vi.fn(),retry:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams('')}));
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}));
vi.mock('@/lib/staff-role',async(o)=>({...await o<typeof import('@/lib/staff-role')>(),useStaffRole:()=> 'owner'}));
vi.mock('@/lib/api',async(o)=>({...await o<typeof import('@/lib/api')>(),api:{autoReplies:{runs:f.runs,retryRun:f.retry}}}));
import Runs from '@/v8/auto-replies/runs';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(()=>{
 vi.clearAllMocks();window.history.replaceState(null,'','/');(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 f.runs.mockResolvedValue({success:true,data:{rule:{id:'rule-synthetic',name:'synthetic',isActive:false},items:[{id:'run-synthetic',occurredAt:'2026-10-01T00:00:00Z',friendName:'synthetic',status:'failed',canRetry:true,actionSummary:{failed:1},durationMs:1,triggerLabel:'synthetic'}],pagination:{total:1},summary:{errors:1,monthHits:1,totalHits:1,handovers:0},handovers:{waiting:0,inProgress:0,completed:0},triggerBreakdown:[]}});
 f.retry.mockRejectedValue(new Error('synthetic ordinary failure'));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
it('OPS-C02 auto reply ordinary failure is presented as no retryable work',async()=>{
 await act(async()=>root.render(<Runs/>));
 const b=[...host.querySelectorAll('button')].find(x=>x.textContent?.includes('失敗した処理をもう一度'));
 expect(b).toBeTruthy();await act(async()=>{b!.click()});
 expect(f.retry).toHaveBeenCalledWith('run-synthetic');
 expect(host.textContent).toContain('1 件をもう一度実行できませんでした');expect(host.textContent).not.toContain('もう一度実行できる処理はありませんでした。');
});

it('送達不明は要確認と確認方法を表示し、canRetryが残っていても再実行しない', async()=>{
 const response = await f.runs();
 response.data.items[0].errorCode = 'delayed_delivery_unknown';
 f.runs.mockResolvedValue(response);
 await act(async()=>root.render(<Runs/>));
 expect(host.textContent).toContain('要確認');
 expect(host.textContent).toContain('届いたか確認できないため');
 expect(host.textContent).toContain('相手に到着を確認');
 expect([...host.querySelectorAll('button')].some(x=>x.textContent?.includes('失敗した処理をもう一度'))).toBe(false);
 const menu=host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
 if(menu) await act(async()=>menu.click());
 expect(host.textContent).not.toContain('もう一度実行');
 expect(f.retry).not.toHaveBeenCalled();
});
