// @vitest-environment happy-dom
import React from 'react';
import {render,screen,fireEvent,act,cleanup,waitFor} from '@testing-library/react';
import {vi,it,expect,afterEach} from 'vitest';
const m=vi.hoisted(()=>({latest:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/api',async(original)=>({...await original<any>(),api:{analytics:{v6Funnels:{list:m.list,latestRun:m.latest}}}}));
vi.mock('@/components/shared/list-navigation',()=>({useListNavigationRouter:()=>({push:vi.fn(),replace:vi.fn()})}));
vi.mock('@/components/shared/period-picker',()=>({default:()=>null,useReportPeriod:()=>({days:30,setDays:vi.fn(),customRange:null,setRange:vi.fn()})}));
import FunnelV8 from '@/v8/analytics/funnel';
afterEach(cleanup);
const fixture={id:'f',name:'fixture funnel',windowDays:30,createdAt:'2026-01-01',status:'active',currentVersion:{id:'v',versionNumber:1,createdAt:'2026-01-01'},migrationState:'ready'};
it('UI-N05 resolved not-found positive control displays empty guidance',async()=>{
 m.list.mockResolvedValue({success:true,data:[fixture]});m.latest.mockResolvedValue({success:false,error:'Not found'});
 render(<FunnelV8 accountId="fixture-a" canManage={false}/>);
 expect(await screen.findByText(/まだ集計がありません/)).toBeTruthy();
});
it('UI-N05 rejected HTTP 404 displays empty guidance after initial load and retry',async()=>{
 const {ApiError}=await import('@/lib/api');m.latest.mockReset();m.latest.mockRejectedValue(new ApiError(404,'Not found'));
 render(<FunnelV8 accountId="fixture-a" canManage={false}/>);
 await waitFor(()=>expect(m.latest).toHaveBeenCalledTimes(1));await act(async()=>{await Promise.resolve();await Promise.resolve()});
 expect(await screen.findByText(/まだ集計がありません/)).toBeTruthy();expect(screen.queryByText('Not found')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'最新の結果をもう一度読む'}));await waitFor(()=>expect(m.latest).toHaveBeenCalledTimes(2));
 expect(await screen.findByText(/まだ集計がありません/)).toBeTruthy();
});

it('UI-N05 ordinary failure is distinct from no aggregation and can be retried',async()=>{
 const {ApiError}=await import('@/lib/api');m.latest.mockReset();m.latest.mockRejectedValueOnce(new ApiError(500,'synthetic unavailable')).mockResolvedValue({success:false,error:'Not found'});
 render(<FunnelV8 accountId="fixture-a" canManage={false}/>);
 expect(await screen.findByText(/最新の集計を読み込めませんでした/)).toBeTruthy();
 expect(screen.queryByText(/まだ集計がありません/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'最新の結果をもう一度読む'}));
 expect(await screen.findByText(/まだ集計がありません/)).toBeTruthy();
 expect(screen.queryByText(/最新の集計を読み込めませんでした/)).toBeNull();
});
