import type { StyleBooking, StyleMetric, IndustryStyle } from '@line-crm/shared';
export type StyleAnalyticsContext = {
 db:D1Database; account:string; query:Record<string,string|undefined>; now:number;
 window:{from:string;to:string;fromDate:string;toDate:string}; from:number;to:number;timeZone:string;
 rows:StyleBooking[];raw:StyleBooking[];style:IndustryStyle;staffId?:string;settings:Record<string,number>;
 metrics:Record<string,StyleMetric>;analytics:Record<string,unknown>;period:(from:number,to:number)=>StyleBooking[];
};
