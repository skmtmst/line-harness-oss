import { getPageAction } from '@/test-utils/page-action'
// @vitest-environment happy-dom
import React from 'react'
import { fireEvent, render, screen, cleanup, waitFor, act, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const currentAccount = vi.hoisted(() => ({ id: 'account-a' }))
const createEvent = vi.hoisted(() => vi.fn())
const createSlots = vi.hoisted(() => vi.fn())
const updateEvent = vi.hoisted(() => vi.fn())
const updateSlot = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(), eventsApi: { createEvent, createSlots, updateEvent, updateSlot, listSlots }, ApiError: class extends Error {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: currentAccount.id }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/v8/events/application-preview', () => ({ default: () => null }))
import EventsCreate from '@/v8/events/create'

beforeEach(() => {
  currentAccount.id = 'account-a'
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
 expect(screen.getByRole('dialog',{name:'イベントを公開する'})).toBe(confirm);
 expect(within(confirm).getByRole('alert').textContent).toContain('最初の予約枠を作れませんでした');
 fireEvent.click(within(confirm).getByRole('button',{name:'キャンセル'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 fireEvent.change(screen.getByLabelText('イベント名'),{target:{value:'修正した名前'}});
 fireEvent.click(getPageAction({name:'下書きを保存'}));await waitFor(()=>expect(push).toHaveBeenCalled());
 expect(createEvent).toHaveBeenCalledTimes(1);expect(createSlots).toHaveBeenCalledTimes(2);expect(updateEvent).toHaveBeenCalledWith('account-a','fixture-event',expect.objectContaining({name:'修正した名前',is_published:1}),1);
 expect(createSlots.mock.calls[1][2][0].client_key).toBe('first-slot:fixture-event');
});
it('保存待ちの連続クリックは本体要求1回、作成結果が不明なら入力を保持して再作成を止める',async()=>{
 let reject!:(e:Error)=>void;createEvent.mockImplementation(()=>new Promise((_,r)=>{reject=r}));
 render(<EventsCreate/>);fill();const btn=getPageAction({name:'下書きを保存'});fireEvent.click(btn);fireEvent.click(btn);
 expect(createEvent).toHaveBeenCalledTimes(1);expect((screen.getByRole('button',{name:'保存しています…'}) as HTMLButtonElement).disabled).toBe(true);
 expect((getPageAction({name:'公開する'}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>reject(new Error('fixture offline')));
 await screen.findByText(/イベントの作成結果を確認できませんでした/);
 expect((getPageAction({name:'下書きを保存'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(getPageAction({name:'下書きを保存'}));fireEvent.click(screen.getByRole('button',{name:'もう一度保存する'}));
 expect(createEvent).toHaveBeenCalledTimes(1);
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
 render(<EventsCreate/>);fill();fireEvent.click(getPageAction({name:'下書きを保存'}));
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


it('公開の保存中は公開ボタンだけ処理中になり、下書きは元の名前で押せない', async () => {
 let finish!: (value: {id:string;version:number;is_published:number}) => void
 createEvent.mockImplementation(() => new Promise(resolve => { finish = resolve }))
 createSlots.mockResolvedValue({items:[{id:'slot',version:1}]})
 render(<EventsCreate/>); fill(); fireEvent.click(getPageAction({name:'公開する'}))
 const confirm = await screen.findByRole('dialog',{name:'イベントを公開する'})
 fireEvent.click(within(confirm).getByRole('button',{name:'公開する'}))
 const footer = document.querySelector('[data-template-region="footer"]') as HTMLElement
 expect((within(footer).getByRole('button',{name:'保存しています…'}) as HTMLButtonElement).disabled).toBe(true)
 expect((within(footer).getByRole('button',{name:'下書きを保存'}) as HTMLButtonElement).disabled).toBe(true)
 await act(async () => finish({id:'fixture-event',version:1,is_published:1}))
})

it('公開確認に対象と環境を表示し、アカウント変更後は古い確認を閉じる', async () => {
 const view=render(<EventsCreate/>); fill(); fireEvent.click(getPageAction({name:'公開する'}))
 const confirm=await screen.findByRole('dialog',{name:'イベントを公開する'})
 expect(confirm.textContent).toContain('LINEアカウント'); expect(confirm.textContent).toContain('環境')
 currentAccount.id='account-b'; view.rerender(<EventsCreate/>); await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
 currentAccount.id='account-a'; view.rerender(<EventsCreate/>); expect(screen.queryByRole('dialog')).toBeNull(); expect(createEvent).not.toHaveBeenCalled()
})
