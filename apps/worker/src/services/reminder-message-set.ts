import type { Message } from '@line-crm/line-sdk';
import { buildMessage } from './line-message.js';

export interface ReminderMessagePart {messageType:string;messageContent:string}
export interface BuiltReminderMessage extends ReminderMessagePart {
 message:Message;templateId:string|null;templateVersion?:number|null;
 messages?:Message[];messageParts?:ReminderMessagePart[];
 frozenType?:string;frozenContent?:string;
}
/** 同じretry keyでは、一度固定した全吹き出しを同じ順で再送する。 */
export function restoreReminderMessage(input:ReminderMessagePart&{templateId:string|null}):BuiltReminderMessage{
 if(input.messageType!=='message_set')return {...input,message:buildMessage(input.messageType,input.messageContent)};
 const parts=JSON.parse(input.messageContent) as ReminderMessagePart[];
 if(!Array.isArray(parts)||parts.length<1||parts.length>5||parts.some(part=>typeof part?.messageType!=='string'||typeof part?.messageContent!=='string'))throw new Error('REMINDER_MESSAGE_SET_INVALID');
 const messages=parts.map(part=>buildMessage(part.messageType,part.messageContent));
 return {...parts[0],templateId:input.templateId,message:messages[0],messages,messageParts:parts};
}
