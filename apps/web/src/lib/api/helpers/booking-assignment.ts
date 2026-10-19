import type { BookingAssignmentSettings, BookingAssignmentWrite } from '@line-crm/shared';
import { fetchApi } from '../../api';

const peoplePath = (accountId: string) => `/api/booking/admin/assignment-settings?account_id=${encodeURIComponent(accountId)}`;
const tablePath = (accountId: string, storeId: string) => `/api/restaurant-test/assignment-settings?account_id=${encodeURIComponent(accountId)}&storeId=${encodeURIComponent(storeId)}`;
type Response = { success: true; data: BookingAssignmentSettings };
export const bookingAssignmentApi = {
  get: (accountId: string) => fetchApi<Response>(peoplePath(accountId)),
  save: (accountId: string, input: BookingAssignmentWrite) => fetchApi<Response>(peoplePath(accountId), { method: 'PUT', body: JSON.stringify(input) }),
  getTables: (accountId: string, storeId: string) => fetchApi<Response>(tablePath(accountId, storeId)),
  saveTables: (accountId: string, storeId: string, input: BookingAssignmentWrite) => fetchApi<Response>(tablePath(accountId, storeId), { method: 'PUT', body: JSON.stringify(input) }),
};
