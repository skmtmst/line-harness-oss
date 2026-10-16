export const HQ_CATALOG_TEMPLATE_TYPES=['booking_menu','mileage_reward'] as const;
export type HqCatalogTemplateType=typeof HQ_CATALOG_TEMPLATE_TYPES[number];
/** 予約メニューは店の保存項目と同じ。参照は配り先の同名タグへ解決する。 */
export interface HqBookingMenuSettings {
 name:string;category_label?:string|null;description?:string|null;duration_minutes:number;
 buffer_after_minutes?:number;base_price:number;price_mode?:'fixed'|'free'|'inquiry';sort_order?:number;
 concurrent_capacity?:number;booking_window_days?:number|null;cutoff_hours_before?:number|null;
 cancel_deadline_hours_before?:number|null;intake_question?:string|null;autoTagName?:string|null;
}
export interface HqMileageRewardSettings {
 name:string;description?:string|null;imageUrl?:string|null;rewardKind:'coupon'|'tag'|'scenario'|'template'|'early_access'|'rank';
 requiredMiles:number;stockLimit?:number|null;perFriendLimit?:number|null;startsAt?:string|null;endsAt?:string|null;
 benefitExpiresDays?:number|null;commonActionName?:string|null;failurePolicy?:'retry'|'refund'|'manual';customerMessage?:string;
 targetConditions?:{operator:'AND'|'OR';rules:Array<{type:string;value:unknown}>;groups?:HqMileageRewardSettings['targetConditions'][]}|null;
}
export type HqCatalogTemplateDefinition={schemaVersion:1;settings:HqBookingMenuSettings|HqMileageRewardSettings};
