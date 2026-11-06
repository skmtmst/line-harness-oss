// @vitest-environment happy-dom
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.hoisted(()=>{process.env.NEXT_PUBLIC_API_URL='http://worker.test'});
vi.mock('next/navigation',async () => (await import('@/test-utils/navigation-mock')).navigationMock());
const fixture=vi.hoisted(()=>({role:'owner'}));
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'a',loading:false})}));
vi.mock('@/lib/staff-role',async original=>({...await original(),useStaffRole:()=>fixture.role}));
import AdConnections from '@/v8/inflow-links/ad-connections';
const items=[{pointId:'p',pointName:'購入',eventType:'purchase',provider:'meta',mode:'auto',eventName:'Purchase',automaticEventName:'Purchase',googleActionId:null,version:0},{pointId:'p',pointName:'購入',eventType:'purchase',provider:'google',mode:'auto',eventName:'purchase',automaticEventName:'purchase',googleActionId:null,version:0}];
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
beforeEach(()=>{fixture.role='owner';window.history.replaceState(null,'','/inflow-links')});
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})}
function other(path:string){return response({success:true,data:path.endsWith('/logs')?{items:[],total:0}:[]})}
it('loads and saves a manual provider mapping through the real API client',async()=>{
 const requests:Array<unknown>=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const path=new URL(String(_url)).pathname;
  if(init?.method==='PUT'){const body=JSON.parse(String(init.body));requests.push(body);return new Response(JSON.stringify({success:true,data:{...items[0],...body,version:1}}),{headers:{'content-type':'application/json'}})}
  return path.endsWith('/mappings')?response({success:true,data:items}):other(path)
 }));
 render(<AdConnections/>);
 fireEvent.click(await screen.findByRole('button',{name:'購入 metaの対応を編集'}));
 const mode=await screen.findByLabelText('購入 metaの対応方法');fireEvent.click(mode);fireEvent.click((await screen.findByRole('option',{name:'名前を指定する'})).querySelector('button')!);
 fireEvent.change(screen.getByLabelText('購入 metaに返す名前'),{target:{value:'CustomPurchase'}});
 fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));
 await waitFor(()=>expect(requests).toContainEqual(expect.objectContaining({account_id:'a',provider:'meta',mode:'manual',eventName:'CustomPurchase',expectedVersion:0})));
});
it('shows a retry after load failure and prevents staff edits',async()=>{
 fixture.role='staff';let fail=true;vi.stubGlobal('fetch',vi.fn(async url=>new URL(String(url)).pathname.endsWith('/mappings')?response(fail?{success:false,error:'Unavailable'}:{success:true,data:items},fail?503:200):other(new URL(String(url)).pathname)));
 render(<AdConnections/>);await screen.findByText('対応表を読み込めませんでした');fail=false;fireEvent.click(screen.getByRole('button',{name:'もう一度読み込む'}));
 await screen.findByText('Purchase');expect(screen.queryByRole('button',{name:/の対応を編集/})).toBeNull();expect(screen.queryByText('保存')).toBeNull();
});
it('Googleの成果IDと版を保存し、保存が失敗したら入力を残してやり直せる',async()=>{
 const requests:Array<unknown>=[];let reject=true;
 vi.stubGlobal('fetch',vi.fn(async(url:unknown,init?:RequestInit)=>{
  const path=new URL(String(url)).pathname;
  if(init?.method==='PUT'){
   const body=JSON.parse(String(init.body));requests.push(body);
   return response(reject?{success:false,error:'保存できませんでした'}:{success:true,data:{...items[1],...body,version:1}});
  }
  return path.endsWith('/mappings')?response({success:true,data:items}):other(path);
 }));
 render(<AdConnections/>);
 fireEvent.click(await screen.findByRole('button',{name:'購入 googleの対応を編集'}));
 fireEvent.change(await screen.findByLabelText('購入 Googleの成果ID'),{target:{value:'conversion-123'}});
 fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));
 await screen.findByText('保存できませんでした');
 expect((screen.getByLabelText('購入 Googleの成果ID') as HTMLInputElement).value).toBe('conversion-123');
 reject=false;fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));
 await waitFor(()=>expect(requests).toHaveLength(2));
 expect(requests[1]).toEqual(expect.objectContaining({account_id:'a',provider:'google',mode:'auto',eventName:null,googleActionId:'conversion-123',expectedVersion:0}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'購入の広告への対応'})).toBeNull());
});
