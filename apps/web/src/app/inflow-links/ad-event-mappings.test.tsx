// @vitest-environment happy-dom
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.hoisted(()=>{process.env.NEXT_PUBLIC_API_URL='http://worker.test'});
import {AdEventMappings} from './ad-event-mappings';
const items=[{pointId:'p',pointName:'購入',eventType:'purchase',provider:'meta',mode:'auto',eventName:'Purchase',automaticEventName:'Purchase',googleActionId:null,version:0},{pointId:'p',pointName:'購入',eventType:'purchase',provider:'google',mode:'auto',eventName:'purchase',automaticEventName:'purchase',googleActionId:null,version:0}];
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('loads and saves a manual provider mapping through the real API client',async()=>{
 const requests:Array<unknown>=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{
  if(init?.method==='PUT'){const body=JSON.parse(String(init.body));requests.push(body);return new Response(JSON.stringify({success:true,data:{...items[0],...body,version:1}}),{headers:{'content-type':'application/json'}})}
  return new Response(JSON.stringify({success:true,data:items}),{headers:{'content-type':'application/json'}})
 }));
 render(<AdEventMappings accountId="a" canWrite/>);
 const mode=await screen.findByLabelText('購入 metaの対応方法');fireEvent.click(mode);fireEvent.click((await screen.findByRole('option',{name:'名前を指定する'})).querySelector('button')!);
 fireEvent.change(screen.getByLabelText('購入 metaに返す名前'),{target:{value:'CustomPurchase'}});
 fireEvent.click(screen.getAllByText('保存')[1]);
 await waitFor(()=>expect(requests).toContainEqual(expect.objectContaining({account_id:'a',provider:'meta',mode:'manual',eventName:'CustomPurchase',expectedVersion:0})));
});
it('shows a retry after load failure and prevents staff edits',async()=>{
 let fail=true;vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(fail?{success:false,error:'Unavailable'}:{success:true,data:items}),{status:fail?503:200,headers:{'content-type':'application/json'}})));
 render(<AdEventMappings accountId="a" canWrite={false}/>);await screen.findByRole('alert');fail=false;fireEvent.click(screen.getByText('読み直す'));
 expect((await screen.findByLabelText('購入 metaの対応方法') as HTMLSelectElement).disabled).toBe(true);expect(screen.queryByText('保存')).toBeNull();
});
