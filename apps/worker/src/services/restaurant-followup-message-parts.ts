import type { BroadcastMessagePart } from '../features/broadcasts/broadcast-message-set/index.js';
import type { RestaurantFollowupTrigger } from '@line-crm/shared';

/** 本文を変えても、来店確認の返事と招待の予約・見送りの入口は失わない。 */
export function protectRestaurantFollowupMessageParts(trigger:RestaurantFollowupTrigger,parts:BroadcastMessagePart[]):BroadcastMessagePart[]{
 const content=JSON.stringify(parts);
 if(trigger==='reservation_24h'&&!['restaurant_going','restaurant_change','restaurant_cancel'].every(key=>content.includes(`{{var.${key}}}`))){
  parts=[...parts,{id:'confirmation',messageType:'flex',messageContent:JSON.stringify({type:'bubble',body:{type:'box',layout:'vertical',contents:[{type:'text',text:'ご予約について',wrap:true}]},footer:{type:'box',layout:'vertical',contents:[
   {type:'button',action:{type:'postback',label:'行きます',data:'{{var.restaurant_going}}'}},
   {type:'button',action:{type:'postback',label:'変更したい',data:'{{var.restaurant_change}}'}},
   {type:'button',action:{type:'postback',label:'取り消す',data:'{{var.restaurant_cancel}}'}},
  ]}})}];
 }
 if(trigger==='waitlist_invited'&&!['waitlist_book_url','waitlist_decline_url'].every(key=>content.includes(`{{var.${key}}}`)))
  parts=[...parts,{id:'invitation',messageType:'text',messageContent:'この時間で予約する：{{var.waitlist_book_url}}\n今回は見送る：{{var.waitlist_decline_url}}'}];
 if(parts.length>5)throw new Error('予約の返事の入口を含めて5つ以内になるよう、吹き出しを減らしてください');
 return parts;
}
