// @vitest-environment happy-dom
import React from 'react'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
const api=vi.hoisted(()=>({responseAnalysis:vi.fn(),responseConversations:vi.fn()}))
vi.mock('@/lib/api/helpers/gap3',()=>({gap3InboxApi:api}))
const {default:InboxResponse}=await import('./inbox-response')
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('新しい記録だけを集計し、削除済みの注記と対象の会話一覧を出す',async()=>{
 api.responseAnalysis.mockResolvedValue({success:true,data:{summary:{medianFirstResponseMinutes:5,withinSlaRate:50,overdueCount:1,totalCount:2},byStaff:[{staffId:'s',staffDeleted:false,staffName:'担当',count:2,deletedCount:1,medianFirstResponseMinutes:5,withinSlaRate:50}],automatic:{count:0,deletedCount:0,unavailableCount:0},weekly:[]}})
 api.responseConversations.mockResolvedValue({success:true,data:{items:[{sampleId:'r',chatId:'c',friendId:'f',friendName:'会話の名前',respondedAt:'2026-11-05T00:00:00Z'}],hasMore:false}})
 render(<InboxResponse accountId="a" />)
 expect(await screen.findByText(/それ以前の返信は含みません/)).toBeTruthy()
 expect(screen.getByText('一部は削除済み')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'2 件'}))
 expect(await screen.findByText('会話の名前')).toBeTruthy()
 expect(screen.getByRole('link',{name:'会話を開く'}).getAttribute('href')).toBe('/chats?friend=f')
 expect(api.responseConversations).toHaveBeenCalledWith('a',expect.any(String),expect.any(String),'s',false,0,'manual')
})
