import { logger } from '@line-crm/shared/server';

/** 版に保存した全吹き出しを、通常読取と配信の一括読取で同じように復元する。 */
export function reminderVersionMessageParts(settingsJson:string|null|undefined):Map<string,string>|null{
 const values=new Map<string,string>();
 if(!settingsJson)return values;
 try{
  const settings=JSON.parse(settingsJson) as {steps?:Array<{stableStepId:string;messageParts?:unknown}>};
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw new Error('invalid_message_settings');
  if(settings.steps!==undefined&&!Array.isArray(settings.steps))throw new Error('invalid_message_steps');
  for(const step of settings.steps??[])if(Array.isArray(step?.messageParts))values.set(step.stableStepId,JSON.stringify(step.messageParts));
 }catch{logger.warn('reminder_message_parts_invalid');return null;}
 return values;
}
