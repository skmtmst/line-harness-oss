// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
const state=vi.hoisted(()=>({ send:vi.fn(), get:vi.fn(async()=>({success:true,data:{lineAccountId:'b'}})) }))
vi.mock('@/lib/line-accounts-cache',()=>({loadLineAccounts:async()=>({success:true,data:[{id:'a',name:'店A'},{id:'b',name:'店B'}]})}))
vi.mock('@/lib/api',async original=>{const actual=await original<typeof import('@/lib/api')>();return {...actual,api:{...actual.api,friends:{...actual.api.friends,get:state.get}}}})
vi.mock('@/components/chats/template-picker',()=>({default:()=>null}))
vi.mock('@/components/shared/sender-select',()=>({default:()=>null}))
vi.mock('@/components/shared/use-permission-lock-reason',()=>({usePermissionLockReason:()=>undefined}))
import InboxReplyComposer from './inbox-reply-composer'
type Props=ComponentProps<typeof InboxReplyComposer>
const props=(overrides:Partial<Props>={}):Props=>({staffRole:'owner',scheduledSends:[],pendingPack:null,messageContent:'予約本文',messageLength:4,pendingImage:null,pendingAttachment:null,quotedMessage:null,chatDetail:{id:'chat-1',friendId:'friend-1',friendName:'お客様'},textareaRef:{current:null},imageInputRef:{current:null},isComposingRef:{current:false},memoPopoverRef:{current:null},showTemplatePicker:false,setShowTemplatePicker:vi.fn(),setMessageContent:vi.fn(),setScheduleInput:vi.fn(),setShowSchedulePanel:vi.fn(),selectedChatId:'chat-1',selectedAccountId:'a',showSchedulePanel:true,scheduleInput:'2099-01-01T09:00',handleScheduleSend:state.send,...overrides} as Props)
afterEach(()=>{cleanup();state.send.mockReset();state.get.mockReset().mockResolvedValue({success:true,data:{lineAccountId:'b'}})})
it('予約対象の友だちの所属先を示し、会話切替後の古い確認を断る',async()=>{
 const view=render(<InboxReplyComposer {...props()} />)
 const dialog=await screen.findByRole('dialog',{name:'予約して送る'})
 expect(await within(dialog).findByText('店B')).toBeTruthy()
 expect(within(dialog).queryByText('店A')).toBeNull()
 expect(within(dialog).getByText('環境')).toBeTruthy()
 const button=within(dialog).getByRole('button',{name:/に予約/})
 const key=Object.keys(button).find(k=>k.startsWith('__reactProps$'))!
 const old=(button as unknown as Record<string,{onClick:()=>void}>)[key].onClick
 view.rerender(<InboxReplyComposer {...props({selectedChatId:'chat-2',chatDetail:null})} />)
 view.rerender(<InboxReplyComposer {...props()} />)
 await act(async()=>old())
 expect(state.send).not.toHaveBeenCalled()
})
it('対象を確認して予約を押すと、確認した会話の予約処理を呼ぶ',async()=>{
 render(<InboxReplyComposer {...props()} />)
 const dialog=await screen.findByRole('dialog',{name:'予約して送る'})
 expect(await within(dialog).findByText('店B')).toBeTruthy()
 fireEvent.click(within(dialog).getByRole('button',{name:/に予約/}))
 expect(state.send).toHaveBeenCalledTimes(1)
})
it('友だちの所属先を取得できないとき、選択中の別アカウントを代用しない',async()=>{
 state.get.mockRejectedValueOnce(new Error('unavailable'))
 render(<InboxReplyComposer {...props()} />)
 const dialog=await screen.findByRole('dialog',{name:'予約して送る'})
 expect(await within(dialog).findByText('不明')).toBeTruthy()
 expect(within(dialog).queryByText('店A')).toBeNull()
})
