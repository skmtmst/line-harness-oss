/** B-349: API contracts for the third gap tranche. No live external writes. */
export type InboxStrategy='none'|'even'|'priority'|'random_weighted';
export interface InboxRoutingTarget {staffId:string;priority:number;cap:number}
export interface RankTier {id:string;name:string;threshold:number;mileMultiplier:number;tagId?:string}
export interface RankProgram {metric:'visits'|'amount'|'miles';windowMonths:number;status:'stopped'|'active';version:number;activatedAt:string|null;tiers:RankTier[];notificationsAvailable:false}
export interface CustomerSegments {cells:Array<{r:number;f:number;name:string;count:number|null;optedOutCount:number|null}>;outside:{count:number|null};total:number|null;computedAt:string|null;status:string}
export type StoreComparisonKey='friendChange'|'blockRate'|'clickRate'|'bookings'|'visits'|'noShowRate'|'responseMinutes';
export interface StoreComparisonRow {accountId:string;name:string;style:string|null;computedAt:string|null;metrics:Record<StoreComparisonKey,{value:number|null;diff:number|null;unit:string;available:boolean}>}
export interface StoreComparisonResult {rows:StoreComparisonRow[];average:Record<StoreComparisonKey,number|null>;total:number;computedAt:string|null}
export type AutoLineKind='cart'|'browse'|'restock';
export interface AutoLineRule {kind:AutoLineKind;enabled:boolean;waitMinutes:number;messages:unknown[];version:number;testMode:true}
export interface BookingPassPlan {id:string;kind:'ticket'|'monthly';name:string;price:number;count:number|null;monthlyLimit:number|null;validDays:number;menuIds:string[];allowWithoutPass:boolean;status:'draft'|'on_sale'|'stopped';version:number}
export type BookingPassPlanWrite=Omit<BookingPassPlan,'id'|'status'|'version'>;
export interface McpConnection {id:string;name:string;level:'read';accounts:Array<{id:string;name:string}>;keyPrefix:string;expiresAt:string;lastUsedAt:string|null;status:'active'|'stopped'|'expired';previousKeyExpiresAt:string|null;version:number}
export interface AiAnswerLog {id:string;createdAt:string;chatId:string|null;friendId:string|null;friendName:string|null;questionText:string;action:'answered'|'handed_off'|'customer_asked_human';handoffReason:string|null;qaEntryId:string|null;qaTitle:string|null;qaVersion:number|null}
