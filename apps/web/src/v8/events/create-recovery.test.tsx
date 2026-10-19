// @vitest-environment happy-dom
import React from 'react'
import { fireEvent, render, screen, cleanup, waitFor, act, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createEvent = vi.hoisted(() => vi.fn())
const createSlots = vi.hoisted(() => vi.fn())
const updateEvent = vi.hoisted(() => vi.fn())
const updateSlot = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ eventsApi: { createEvent, createSlots, updateEvent, updateSlot, listSlots }, ApiError: class extends Error {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('@/v8/events/application-preview', () => ({ default: () => null }))
import EventsCreate from '@/v8/events/create'

beforeEach(() => {
  createEvent.mockReset()
  updateEvent.mockReset()
  updateSlot.mockReset()
  listSlots.mockReset()
  createSlots.mockReset()
  push.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

function fill(){fireEvent.change(screen.getByLabelText('イベント名'),{target:{value:'元の名前'}});fireEvent.change(screen.getByLabelText('定員'),{target:{value:'2'}});}
it('実画面: 枠失敗は公開済みの本体と残りを分け、変更は取得済みの版で更新する',async()=>{
 createEvent.mockResolvedValue({id:'fixture-event',version:1,is_published:1});updateEvent.mockResolvedValue({id:'fixture-event',version:2,is_published:1});createSlots.mockRejectedValueOnce(new Error('fixture slots offline')).mockImplementation(async (_account, eventId, slots) => ({ items: [{ ...slots[0], id: 'fixture-slot', event_id: eventId, version: 1 }] }));
 render(<EventsCreate/>);fill();fireEvent.click(screen.getByRole('button',{name:'公開する'}));
 expect(createEvent).not.toHaveBeenCalled();
 const confirm=await screen.findByRole('dialog',{name:'イベントを公開する'});fireEvent.click(within(confirm).getByRole('button',{name:'公開する'}));
 await screen.findByText(/できた分：イベント本体（公開済み）/);
 expect(screen.getByText('残り：最初の予約枠')).toBeTruthy();
 expect(createEvent.mock.calls[0][1]).toMatchObject({name:'元の名前',is_published:1});
 expect((screen.getByLabelText('イベント名') as HTMLInputElement).value).toBe('元の名前');
 fireEvent.change(screen.getByLabelText('イベント名'),{target:{value:'修正した名前'}});
 fireEvent.click(screen.getByRole('button',{name:'下書きを保存'}));await waitFor(()=>expect(push).toHaveBeenCalled());
 expect(createEvent).toHaveBeenCalledTimes(1);expect(createSlots).toHaveBeenCalledTimes(2);expect(updateEvent).toHaveBeenCalledWith('account-a','fixture-event',expect.objectContaining({name:'修正した名前',is_published:1}),1);
 expect(createSlots.mock.calls[1][2][0].client_key).toBe('first-slot:fixture-event');
});
it('保存待ちの連続クリックは本体要求1回、失敗後は入力を保持',async()=>{
 let reject!:(e:Error)=>void;createEvent.mockImplementation(()=>new Promise((_,r)=>{reject=r}));
 render(<EventsCreate/>);fill();const btn=screen.getByRole('button',{name:'下書きを保存'});fireEvent.click(btn);fireEvent.click(btn);
 expect(createEvent).toHaveBeenCalledTimes(1);expect((btn as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>reject(new Error('fixture offline')));
 await waitFor(()=>expect((btn as HTMLButtonElement).disabled).toBe(false));
 expect((screen.getByLabelText('イベント名') as HTMLInputElement).value).toBe('元の名前');expect(push).not.toHaveBeenCalled();
});
it('未保存でリンク離脱を止め、編集継続で入力を保つ',async()=>{
 render(<><EventsCreate/><a href="/tags">点検用離脱リンク</a></>);fill();
 fireEvent.click(screen.getByText('点検用離脱リンク'));await screen.findByRole('dialog');
 fireEvent.click(screen.getByRole('button',{name:'編集を続ける'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect((screen.getByLabelText('イベント名') as HTMLInputElement).value).toBe('元の名前');expect(push).not.toHaveBeenCalled();
});

it('枠の作成・更新の応答を失っても、入力と完了分を保ち、残りは最新の版から確認する', async () => {
 createEvent.mockResolvedValue({id:'fixture-event',version:1,is_published:0});
 let stored: Record<string, unknown>;
 createSlots.mockImplementationOnce(async (_account, eventId, slots) => { stored={...slots[0],id:'fixture-slot',event_id:eventId,version:4};throw new Error('作成の応答喪失') });
 createSlots.mockImplementation(async () => ({items:[stored]}));
 updateSlot.mockImplementationOnce(async (_account, _eventId, _slotId, patch) => { stored={...stored,...patch,version:5};throw new Error('更新の応答喪失') });
 listSlots.mockImplementation(async () => ({items:[stored]}));
 render(<EventsCreate/>);fill();fireEvent.click(screen.getByRole('button',{name:'下書きを保存'}));
 await screen.findByText('残り：最初の予約枠');
 fireEvent.change(screen.getByLabelText('定員'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'残りだけもう一度'}));
 await screen.findByText(/できた分：.*最初の予約枠（作成済み）/);
 expect(screen.getByText('残り：予約枠の確認・変更')).toBeTruthy();
 expect(updateSlot.mock.calls[0][4]).toBe(4);
 expect((screen.getByLabelText('定員') as HTMLInputElement).value).toBe('3');
 fireEvent.click(screen.getByRole('button',{name:'残りだけもう一度'}));await waitFor(()=>expect(push).toHaveBeenCalled());
 expect(createEvent).toHaveBeenCalledTimes(1);expect(createSlots).toHaveBeenCalledTimes(2);
 expect(updateSlot).toHaveBeenCalledTimes(1);expect(listSlots).toHaveBeenCalledTimes(1);expect(updateEvent).not.toHaveBeenCalled();
})
