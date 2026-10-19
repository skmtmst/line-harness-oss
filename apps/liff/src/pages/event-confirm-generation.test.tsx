// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventConfirm from './event-confirm.js';
import { api } from '../lib/api.js';
vi.mock('../lib/api.js',()=>({api:{
  customerLook: vi.fn().mockResolvedValue({success:true,data:{settings:{liff_theme:'line'}}}),
  liffConfig: vi.fn().mockResolvedValue({success:true,data:{}}),
  bookingSettings: vi.fn().mockResolvedValue({}),
  getEvent: vi.fn().mockResolvedValue({id:'e',name:'人工イベント',venue_name:null,venue_url:null,image_url:null,description:null,description_centered:0,max_bookings_per_friend:null,requires_approval:0,cancel_deadline_hours_before:null}),
  getEventSlots: vi.fn().mockResolvedValue({items:[{id:'s',event_id:'e',starts_at:'2099-01-01T00:00:00Z',ends_at:'2099-01-01T01:00:00Z',capacity:1,is_active:1,active_count:0,remaining:1}]}),
  createEventBooking: vi.fn(),
}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('XL-01: 現LIFFイベントも送信中に前の画面へ戻ると後着成功では完了しない',async()=>{
  let resolve!: (v:{id:string;status:string})=>void;
  const promise=new Promise<{id:string;status:string}>(r=>{resolve=r;});
  vi.mocked(api.createEventBooking).mockReturnValue(promise);
  render(<MemoryRouter initialEntries={['/before','/events/e/confirm?slotId=s']} initialIndex={1}>
    <Routes><Route path='/before' element={<p>日時の選択</p>}/><Route path='/events/:id/confirm' element={<EventConfirm/>}/><Route path='/events/:id/done' element={<p>予約完了</p>}/></Routes>
  </MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'申し込む'}));
  fireEvent.click(screen.getByRole('button',{name:/日時を選び直す|戻る/}));
  await screen.findByText('日時の選択');
  await act(async()=>{resolve({id:'old',status:'confirmed'});await promise;});
  expect(screen.queryByText('予約完了')).toBeNull();
  expect(screen.getByText('日時の選択')).toBeTruthy();
});
