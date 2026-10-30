import type { RestaurantFollowupTrigger } from '@line-crm/shared';

export function validRestaurantFollowupTiming(trigger: RestaurantFollowupTrigger, offset: number, time?: unknown): boolean {
  if(!Number.isSafeInteger(offset)||Math.abs(offset)>525600)return false;
  if(['reservation_24h','reservation_2h','anniversary_before'].includes(trigger)?offset>=0:offset<0)return false;
  if(trigger==='anniversary_before'&&offset%1440!==0)return false;
  return time===undefined||(trigger==='anniversary_before'&&typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time));
}
