import { expect,it } from 'vitest';
import { protectRestaurantFollowupMessageParts } from './restaurant-followup-message-parts.js';
import { buildMessages } from '../features/broadcasts/broadcast-message-set/index.js';
const parts=[{id:'body',messageType:'text',messageContent:'予約ありがとうございます'}];
it('前日の本文だけを保存しても返事の押し口を残し、二重に付けない',()=>{
 const saved=protectRestaurantFollowupMessageParts('reservation_24h',parts);
 expect(saved).toHaveLength(2);expect(buildMessages(saved)).toHaveLength(2);
 expect(protectRestaurantFollowupMessageParts('reservation_24h',saved)).toEqual(saved);
 for(const key of ['restaurant_going','restaurant_change','restaurant_cancel'])expect(JSON.stringify(saved)).toContain(`{{var.${key}}}`);
});
it('招待の予約と見送りの両方を残し、通常のお礼には足さない',()=>{
 const saved=protectRestaurantFollowupMessageParts('waitlist_invited',parts);expect(saved).toHaveLength(2);
 expect(protectRestaurantFollowupMessageParts('waitlist_invited',saved)).toEqual(saved);
 expect(protectRestaurantFollowupMessageParts('post_visit',parts)).toEqual(parts);
});
it('送信上限を超える時は本文を落とさず保存を断る',()=>{
 expect(()=>protectRestaurantFollowupMessageParts('reservation_24h',Array.from({length:5},(_,index)=>({...parts[0],id:String(index)})))).toThrow('吹き出しを減らして');
});
