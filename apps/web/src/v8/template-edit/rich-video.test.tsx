// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { richVideoContent, richVideoDraftError, type RichVideoDraft } from './rich-video-core'
import { messageTemplateToBubble, bubbleLegacyMessage, assetBubbleError } from '@/lib/broadcast-template'
const mocks=vi.hoisted(()=>({role:'owner',account:'a',get:vi.fn(),create:vi.fn(),update:vi.fn(),push:vi.fn(),disarm:vi.fn(),guarded:vi.fn((action:()=>void)=>action())}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push}),usePathname:()=>'/templates/edit',useSearchParams:()=>new URLSearchParams('kind=rich_video')}))
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=>mocks.role,canManageRole:(role:string)=>role==='owner'||role==='admin'}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:mocks.account,accounts:[{id:'a',name:'本店'}]})}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}))
vi.mock('@/lib/use-unsaved-guard',()=>({useUnsavedGuard:()=>({leaveTarget:null,disarm:mocks.disarm,guarded:mocks.guarded})}))
vi.mock('@/lib/unsaved-leave-dialog',()=>({UnsavedLeaveDialog:()=>null}))
vi.mock('@/lib/api',()=>({api:{templates:{get:mocks.get,create:mocks.create,update:mocks.update},folders:{list:async()=>({success:true,data:[]})}}}))
import Editor from './rich-video'
import type { TemplateEditHost } from './host'
const draft:RichVideoDraft={name:'動画',folderId:'',originalContentUrl:'https://worker.example/images/video.mp4',previewImageUrl:'https://worker.example/images/preview.jpg',height:520,buttonEnabled:true,actionLabel:'詳しく見る',actionUrl:'https://example.com/menu',altText:'新しい動画です'}
function stored(button=true){return {...richVideoContent({...draft,buttonEnabled:button}),baseUrl:'https://worker.example/images/imagemaps/map'}}
beforeEach(()=>{vi.clearAllMocks();mocks.role='owner';mocks.account='a';mocks.get.mockResolvedValue({success:true,data:{id:'r',accountId:'a',name:'動画',messageType:'imagemap',messageContent:JSON.stringify(stored()),publishedVersion:1,draftRevision:0}});mocks.update.mockResolvedValue({success:true,data:{id:'r'}})})
afterEach(cleanup)
describe('リッチビデオ編集',()=>{
 it('引用した動画はテンプレートを更新せず入れ直せる。入れ直しが失敗したときは変更を残す',async()=>{
  const insert=vi.fn().mockResolvedValue(false);const cancel=vi.fn()
  const host:TemplateEditHost={composer:{index:2,accountId:'a'},description:'',folders:[],folder:'',onFolderChange:()=>{},busy:false,onSave:insert,onCancel:cancel,initialContent:{kind:'message',name:'動画',messageType:'imagemap',messageContent:JSON.stringify(stored())}}
  render(<Editor host={host}/>);await screen.findByDisplayValue('新しい動画です')
  fireEvent.change(screen.getByLabelText('通知に出る文'),{target:{value:'この配信だけの通知'}})
  fireEvent.click(screen.getByRole('button',{name:'この吹き出しに入れる'}))
  await waitFor(()=>expect(insert).toHaveBeenCalledTimes(1))
  expect(JSON.parse(insert.mock.calls[0][0].messageContent).altText).toBe('この配信だけの通知')
  expect(mocks.create).not.toHaveBeenCalled();expect(mocks.update).not.toHaveBeenCalled();expect(mocks.disarm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'キャンセル',exact:true}));expect(mocks.guarded).toHaveBeenCalledWith(cancel)
 })
 it('読み直した値を表示し、ボタンを外して通知文を更新して保存する',async()=>{
  render(<Editor id="r"/>);await screen.findByDisplayValue('新しい動画です');
  fireEvent.click(screen.getByRole('checkbox',{name:'見終わったあとのボタンを出す'}));
  expect(screen.queryByLabelText('リンク先URL')).toBeNull();
  fireEvent.change(screen.getByLabelText('通知に出る文'),{target:{value:'新しい通知'}});
  fireEvent.click(screen.getByRole('button',{name:'保存する'}));
  await waitFor(()=>expect(mocks.update).toHaveBeenCalled());
  const content=JSON.parse(mocks.update.mock.calls[0][1].messageContent);
  expect(content.altText).toBe('新しい通知');expect(content.video.externalLink).toBeUndefined();expect(content.video.originalContentUrl).toBe(draft.originalContentUrl);
  await waitFor(()=>expect(mocks.push).toHaveBeenCalledWith('/templates'));
 });
 it('閲覧のみには保存・アップロード・スイッチを出さない',async()=>{
  mocks.role='staff';render(<Editor id="r"/>);await screen.findByDisplayValue('新しい動画です');
  expect(screen.getByRole('status').textContent).toContain('閲覧のみ');expect(screen.queryByRole('button',{name:'保存する'})).toBeNull();expect(screen.queryByRole('button',{name:'ファイルを選ぶ'})).toBeNull();expect(screen.queryByRole('checkbox')).toBeNull();
 });
 it('読み込み失敗時に保存せず、別アカウントに切り替えても保存しない',async()=>{
  mocks.get.mockRejectedValue(new Error('failed'));const {unmount}=render(<Editor id="r"/>);await screen.findByRole('alert');expect((screen.getByRole('button',{name:'保存する'}) as HTMLButtonElement).disabled).toBe(true);unmount();
  mocks.account='b';mocks.get.mockResolvedValue({success:true,data:{id:'r',accountId:'a',name:'動画',messageType:'imagemap',messageContent:JSON.stringify(stored())}});render(<Editor id="r"/>);await screen.findByDisplayValue('新しい動画です');expect((screen.getByRole('button',{name:'保存する'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('名前の入力不足はその欄だけに示し、通信せずフォーカスする',async()=>{
  render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:'保存する'}));
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText('テンプレート名')));
  expect(screen.getByLabelText('テンプレート名').getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText('テンプレート名を入力してください。')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();expect(mocks.create).not.toHaveBeenCalled();
 });
 it('ボタン無しはURL不要、URL不正と通知文超過は拒否する',()=>{
  expect(richVideoDraftError({...draft,buttonEnabled:false,actionUrl:''})).toBeNull();
  expect(richVideoDraftError({...draft,actionUrl:'javascript:alert(1)'})).toContain('HTTPS');
  expect(richVideoDraftError({...draft,altText:'あ'.repeat(1501)})).toContain('1,500');
 });
 it('テンプレート引用はrich_videoの中身と通知を保ち、imagemapで保存する',()=>{
  const content=stored(false);const bubble=messageTemplateToBubble({id:'r',name:'動画',category:'general',messageType:'imagemap',messageContent:JSON.stringify(content)})!;
  expect(bubble.type).toBe('rich_video');expect(assetBubbleError(bubble)).toBe('');expect(JSON.parse(bubbleLegacyMessage(bubble).messageContent).video).toEqual(content.video);expect(bubbleLegacyMessage(bubble).messageType).toBe('imagemap');
 });
})
