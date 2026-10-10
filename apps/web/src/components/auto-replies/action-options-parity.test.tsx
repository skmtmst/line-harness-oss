// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
const mocks=vi.hoisted(()=>({templates:vi.fn(),reminders:vi.fn(),events:vi.fn()}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'a'})}))
vi.mock('@/lib/use-admin-theme',()=>({useAdminTheme:()=> 'v8'}))
vi.mock('@/lib/api',()=>({api:{
  tags:{list:async()=>({success:true,data:[]})},friendFields:{list:async()=>({success:true,data:[]})},supportMarks:{list:async()=>({success:true,data:[]})},scenarios:{list:async()=>({success:true,data:[]})},commonVars:{list:async()=>({success:true,data:[]})},notifications:{operatorRules:{list:async()=>({success:true,data:{items:[]}})}},templates:{list:mocks.templates},reminders:{list:mocks.reminders}},eventsApi:{listEvents:mocks.events}}))
import {useActionOptions} from './inline-action-list'
afterEach(cleanup)
test('処理で選ぶテンプレート・リマインダ・イベントを選択中の店から読む',async()=>{
  mocks.templates.mockResolvedValue({success:true,data:[{id:'t',name:'案内'}]})
  mocks.reminders.mockResolvedValue({success:true,data:[{id:'r',name:'翌日'}]})
  mocks.events.mockResolvedValue({items:[{id:'e',name:'相談会'}]})
  const {result}=renderHook(useActionOptions)
  await waitFor(()=>expect(result.current).toMatchObject({templates:[{id:'t',name:'案内'}],reminders:[{id:'r',name:'翌日'}],events:[{id:'e',name:'相談会'}]}))
  expect(mocks.templates).toHaveBeenCalledWith(undefined,'a')
  expect(mocks.reminders).toHaveBeenCalledWith({accountId:'a'})
  expect(mocks.events).toHaveBeenCalledWith('a',{limit:100})
})
