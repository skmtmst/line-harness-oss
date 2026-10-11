import {getVersionedAccountSetting} from '@line-crm/db';
import {resolveCustomerLook, type CustomerLook} from '@line-crm/shared';
export const CUSTOMER_LOOK_KEY='customer.look_v1';
export async function accountCustomerLook(db: D1Database,accountId:string) {
 const value=await getVersionedAccountSetting<CustomerLook>(db,accountId,CUSTOMER_LOOK_KEY);
 return {version:value?.version ?? 0,look:resolveCustomerLook(value?.data)};
}
