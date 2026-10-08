import type { BroadcastDefinitionInput } from './broadcast-definition.js';
/** 統括が追加するのは店の選択のみ。本文・対象条件は店と同じ型を使う。 */
export type HqBroadcastInput = BroadcastDefinitionInput & {
 requestId:string;accountIds:string[];accountTagIds:string[];excludedAccountIds:string[];
 audience:{kind:'all'}|{kind:'tag';tagName:string};scheduledAt:string|null;
};
export interface HqBroadcastPreflight {
 accountId:string;accountName:string;audienceCount:number|null;remaining:number|null;connected:boolean;paused:boolean;
 blockedReasons:string[];excluded:boolean;broadcastId:string|null;
}
export interface HqBroadcastFailure { code:string; label:string; count:number; retryable:boolean }
export type HqBroadcastDraftInput = HqBroadcastInput & { expectedVersion: number };
export interface HqBroadcastRun {
 id:string;title:string;status:string;version:number;scheduledAt:string|null;
 input:HqBroadcastInput; targets:Array<HqBroadcastPreflight & {failureReasons:HqBroadcastFailure[];status:string;version:number;successCount:number;totalCount:number;openedCount?:number|null;clickedCount?:number|null;reactionCount?:number|null;approvalStatus?:string;retryableCount:number;stopped:boolean}>;
}
