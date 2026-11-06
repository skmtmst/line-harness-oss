import { expect,it,vi } from 'vitest';
import type { LineClient,WebhookEvent } from '@line-crm/line-sdk';
import { handleEvent } from './webhook-definition.js';

for(const response of ['going','change','cancel'])it(`見本の${response}の返事は、予約・自動返信・出来事を変えずに受け終える`,async()=>{
 const prepare=vi.fn(()=>{throw new Error('Test response must not read or mutate a reservation');});
 const reply=vi.fn(()=>{throw new Error('Test response must not trigger a reply');});
 const event={type:'postback',postback:{data:`test:restaurant_${response}`},source:{type:'user',userId:'self'},timestamp:Date.now(),webhookEventId:'test-response',replyToken:'reply'} as WebhookEvent;
 await expect(handleEvent({prepare} as unknown as D1Database,{replyMessage:reply} as unknown as LineClient,event,'token','account','scope')).resolves.toBeUndefined();
 expect(prepare).not.toHaveBeenCalled();expect(reply).not.toHaveBeenCalled();
});
