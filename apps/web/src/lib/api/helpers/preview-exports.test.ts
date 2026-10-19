import { beforeEach,expect,test,vi } from 'vitest'
vi.mock('../../api',()=>({fetchApi:vi.fn(),downloadApiFile:vi.fn()}))
import { fetchApi,downloadApiFile } from '../../api'
import { exportWebhookInteractions } from './webhook-export'
import { previewReminderMessage } from './reminder-preview'
beforeEach(()=>{vi.mocked(fetchApi).mockReset().mockResolvedValue({success:true,data:{}});vi.mocked(downloadApiFile).mockReset()})
test('CSV uses authenticated download and reminder preview carries friend, step and fixed draft',async()=>{
  await exportWebhookInteractions({lineAccountId:'a&b',direction:'incoming',search:'登録 済み'})
  expect(downloadApiFile).toHaveBeenLastCalledWith('/api/webhooks/interactions/export.csv?lineAccountId=a%26b&direction=incoming&search=%E7%99%BB%E9%8C%B2+%E6%B8%88%E3%81%BF','webhook-interactions.csv')
  const input={friendId:'f',stableStepId:'s',expectedDraftVersionId:'v',expectedDraftUpdatedAt:'2026-10-15T12:00:00.000'}
  await previewReminderMessage('id/1',input);expect(fetchApi).toHaveBeenLastCalledWith('/api/reminders/id%2F1/message-preview',{method:'POST',body:JSON.stringify(input)})
})
