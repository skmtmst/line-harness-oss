import type { MessageType } from './types.js';
export interface HqBroadcastInput {
 requestId:string;title:string;messageType:MessageType;messageContent:string;messageBubblesJson?:string|null;altText?:string|null;
 accountIds:string[];accountTagIds:string[];excludedAccountIds:string[];
 audience:{kind:'all'}|{kind:'tag';tagName:string};scheduledAt:string|null;
}
export interface HqBroadcastPreflight {
 accountId:string;accountName:string;audienceCount:number|null;remaining:number|null;connected:boolean;paused:boolean;
 blockedReasons:string[];excluded:boolean;broadcastId:string|null;
}
export interface HqBroadcastRun {
 id:string;title:string;status:string;version:number;scheduledAt:string|null;
 targets:Array<HqBroadcastPreflight & {status:string;version:number;successCount:number;totalCount:number;retryableCount:number;stopped:boolean}>;
}
