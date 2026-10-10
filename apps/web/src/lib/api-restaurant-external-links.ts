import type { RestaurantExternalLink, RestaurantExternalLinkChange, RestaurantExternalLinkPage, RestaurantExternalLinkWrite } from '@line-crm/shared';
import { fetchApi } from './api';

const endpoint = (accountId: string, storeId: string, id?: string) =>
  `/api/restaurant-test/external-links${id ? `/${encodeURIComponent(id)}` : ''}?account_id=${encodeURIComponent(accountId)}&storeId=${encodeURIComponent(storeId)}`;
type Result<T> = { success: true; data: T };
export const restaurantExternalLinksApi = {
  list: (accountId: string, storeId: string, offset = 0, reservationId?: string) =>
    fetchApi<Result<RestaurantExternalLinkPage>>(`${endpoint(accountId, storeId)}&offset=${offset}${reservationId ? `&reservationId=${encodeURIComponent(reservationId)}` : ''}`),
  get: (accountId: string, storeId: string, id: string) => fetchApi<Result<RestaurantExternalLink>>(endpoint(accountId, storeId, id)),
  link: (accountId: string, storeId: string, body: RestaurantExternalLinkWrite) =>
    fetchApi<Result<RestaurantExternalLink>>(endpoint(accountId, storeId), { method: 'POST', body: JSON.stringify(body) }),
  relink: (accountId: string, storeId: string, id: string, body: RestaurantExternalLinkChange) =>
    fetchApi<Result<RestaurantExternalLink>>(endpoint(accountId, storeId, id), { method: 'PATCH', body: JSON.stringify(body) }),
  unlink: (accountId: string, storeId: string, id: string, expectedVersion: number) =>
    fetchApi<Result<RestaurantExternalLink>>(endpoint(accountId, storeId, id), { method: 'DELETE', body: JSON.stringify({ expectedVersion }) }),
};
