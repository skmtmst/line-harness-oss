export type RecurrenceFrequency='weekly'|'biweekly'|'monthly_nth';
export interface BookingRecurrence {freq:RecurrenceFrequency;weekday?:number;nth?:number;count?:number;until?:string}
export interface SeriesInput {menuId:string;friendId:string;staffId?:string|null;startsAt:string;rule:BookingRecurrence;choices?:Array<{index:number;action:'keep'|'skip';alternativeStartsAt?:string}>}
export interface SeriesOccurrence {index:number;startsAt:string;available:boolean;staffId:string|null;reason:string|null;alternatives:string[]}
export interface BookingAudienceWrite {audienceMode:'all'|'include_tags'|'exclude_tags';audienceTagIds:string[];expectedVersion:number}
export interface RoutingTarget {menuId:string;staffGroupId?:string;staffId?:string;meetingMode?:'online'|'in_person'}
export interface BookingRouting {enabled:boolean;rules:Array<{conditions:Array<{questionId:string;op:'is'|'in'|'between';value:string|string[]|[number,number]}>;target:RoutingTarget}>;fallback:RoutingTarget}
export interface QaEntryWrite {questions:string[];answer:string;expectedVersion?:number}
export type AiMode='off'|'draft_only'|'auto_qa'|'suspended';
export interface OperatorPushPreferences {kinds:string[];quietStart:string;quietEnd:string;quietAllowCritical:boolean;version:number}
export interface Gap2Booking {id:string;line_account_id:string;friend_id:string;menu_id:string;staff_id:string;starts_at:string;ends_at:string;status:string;price_at_booking:number;series_id?:string|null;series_index?:number|null;nominated?:number;nomination_fee_at_booking?:number;routing_rule_index?:number|null;lock_version:number}
export interface Gap2Series {id:string;line_account_id:string;friend_id:string;menu_id:string;rule_json:string;status:string;version:number}
export interface MakeupCredit {id:string;line_account_id:string;friend_id:string;source_event_booking_id:string|null;source_event_id:string;expires_at:string;status:'open'|'used'|'expired'|'revoked';used_event_booking_id:string|null;version:number}
export interface QaEntry {id:string;account_id:string;questions_json:string;answer_messages_json:string;status:'draft'|'published'|'stopped';version:number;updated_at:string}
export interface AiSummary {lines:string[];generatedAt:string;basedOnMessageId:string|null}
export interface AiReplyDraft {text:string;sources:Array<{type:'qa'|'past_reply';id:string;title:string}>;generatedAt:string;basedOnMessageId:string|null}
