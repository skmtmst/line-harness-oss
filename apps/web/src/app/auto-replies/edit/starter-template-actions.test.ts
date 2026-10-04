import {expect,it} from 'vitest';
import {STARTER_TEMPLATES} from './wizard-v8';
import {toActionPayload} from '@/components/auto-replies/draft-fields';
it('ひな形の通知・タグ付けが保存対象の後続処理になる',()=>{
 const form={responseContent:''} as any;
 const booking=STARTER_TEMPLATES.find(x=>x.key==='booking-change')!.apply(form);
 expect(booking.actions.map(toActionPayload)).toEqual([expect.objectContaining({actionType:'notify_staff',config:expect.objectContaining({notificationRuleId:'',notificationRuleVersion:0})}),expect.objectContaining({actionType:'tag',config:{op:'add',tagIds:[]}})]);
 expect(STARTER_TEMPLATES.find(x=>x.key==='off-hours')!.apply(form).actions[0].actionType).toBe('notify_staff');
});
