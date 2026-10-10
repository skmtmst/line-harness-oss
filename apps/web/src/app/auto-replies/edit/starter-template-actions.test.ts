import {expect,it} from 'vitest';
import {STARTER_TEMPLATES, type WizardForm} from './wizard-v8';
import {toActionPayload} from '@/components/auto-replies/draft-fields';
it('ひな形の通知・タグ付けが保存対象の後続処理になる',()=>{
 const form={responseContent:''} as WizardForm;
 const booking=STARTER_TEMPLATES.find(x=>x.key==='booking-change')!.apply(form);
 expect(booking.actions.map(toActionPayload)).toEqual([expect.objectContaining({actionType:'notify_staff',config:expect.objectContaining({notificationRuleId:'',notificationRuleVersion:0})}),expect.objectContaining({actionType:'tag',config:{op:'add',tagIds:[]}})]);
 expect(STARTER_TEMPLATES.find(x=>x.key==='off-hours')!.apply(form).actions[0].actionType).toBe('notify_staff');
});

it('WEB291: 営業時間外から別の見本へ移ると時間と言葉の条件を戻す',()=>{
 const original={responseContent:''} as WizardForm;
 const off=STARTER_TEMPLATES.find(x=>x.key==='off-hours')!.apply(original);
 for (const key of ['booking-change','faq']) {
   const next=STARTER_TEMPLATES.find(x=>x.key===key)!.apply(off);
   expect(next.respondToAll).toBe(false);
   expect(next.timeMode).toBe('always');
   expect(next.activeFrom).toBe('');
   expect(next.activeUntil).toBe('');
 }
});
