// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BookingHistory from './pages/booking-history.js';
import Confirm from './components/confirm.js';
import type { MenuItem, StaffItem } from './lib/api.js';
import { setLiffContext } from './lib/liff-auth.js';
const ctx={liffId:'fixture',lineUserId:'fixture-user',idToken:'fixture-token'};
const menu: MenuItem = {id:'m',name:'fixture menu',category_label:null,description:null,duration_minutes:30,buffer_after_minutes:0,base_price:1000,sort_order:0};
const staff: StaffItem = {id:'s',display_name:'fixture staff',duration_minutes:30,price:1000,role:null,profile_image_url:null,bio:null,is_designation_optional:0};
const fixtureReply=(j:unknown)=>new Response(JSON.stringify(j),{headers:{'Content-Type':'application/json'}});
beforeEach(()=> {setLiffContext(ctx);vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unexpected network access: all requests must be mocked')}));});
afterEach(()=> {cleanup();vi.unstubAllGlobals();});
it('deployed booking confirmation renders the configured intake question',()=>{
 render(<MemoryRouter><Confirm menu={{...menu,intake_question:'事前に伝えたいことは何ですか？'}} staff={staff} slot={{date:'2026-10-20',start:'10:00'}} autoConfirm={false} onSubmitted={()=>{}} /></MemoryRouter>)
 expect(screen.queryByLabelText('事前に伝えたいことは何ですか？')).not.toBeNull()
})

it('deployed booking history displays the server supplied cancellation deadline', async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>fixtureReply({upcoming:[{id:'b',menu_name:'fixture menu',staff_name:'fixture staff',starts_at:'2099-10-20T01:00:00Z',duration_minutes:30,price:1000,status:'confirmed',cancel_deadline_at:'2099-10-19T01:00:00Z',lock_version:4}],past:[]})))
 render(<MemoryRouter><BookingHistory /></MemoryRouter>)
 await screen.findByText('fixture menu');expect(screen.queryByText(/キャンセル期限：/)).not.toBeNull()
})


it('deployed booking preserves input and the same operation key on failure and retry',async()=>{
 const posted: RequestInit[]=[]
 // createApi treats a 409 as a conflicting slot, before retrying the same request.
 // 予約の送信前に必須の見積もりを正常に読み込む。404なら確認で止まる。
 vi.stubGlobal('fetch',vi.fn(async(_input: RequestInfo | URL, opts: RequestInit = {})=>{if((opts.method??'GET')==='GET')return fixtureReply(String(_input).includes('/cost-estimate') ? {success:true,data:{cancellation:{enabled:false,version:0,price:1000,cardRequired:true,tiers:[{beforeHours:24,percent:0},{beforeHours:0,percent:50}],noShowPercent:100,freeUntil:null},deposit:{amount:0}}} : {success:true,data:[]});posted.push(opts);return new Response(JSON.stringify(posted.length===1?{success:false,error:'slot_conflict'}:{booking_id:'b',status:'requested'}),{status:posted.length===1?409:200,headers:{'Content-Type':'application/json'}})}))
 const done=vi.fn();render(<MemoryRouter><Confirm menu={menu} staff={staff} slot={{date:'2026-10-20',start:'10:00'}} autoConfirm={false} onSubmitted={done} onBack={()=>{}} /></MemoryRouter>)
 const {fireEvent}=await import('@testing-library/react');fireEvent.change(screen.getByRole('textbox'),{target:{value:'fixture note'}});await waitFor(()=>expect((screen.getByRole('button',{name:'この内容で予約をリクエストする'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'この内容で予約をリクエストする'}))
 await screen.findByText(/他の方の予約と重なりました/);expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('fixture note');expect(done).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'この内容で予約をリクエストする'}));await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));expect(posted).toHaveLength(2);expect(new Headers(posted[0].headers).get('Idempotency-Key')).toBe(new Headers(posted[1].headers).get('Idempotency-Key'));expect(posted[0].body).toBe(posted[1].body)
})
