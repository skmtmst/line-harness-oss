import type { RestaurantFollowupPage, RestaurantFollowupTrigger, RestaurantConfirmation } from '@line-crm/shared';
import { fetchApi } from './api';
const endpoint = (accountId: string, storeId: string, suffix = '') => `/api/restaurant-test/followups/${encodeURIComponent(storeId)}${suffix}?account_id=${encodeURIComponent(accountId)}`;
export const restaurantFollowupApi = {
    get: (accountId: string, storeId: string) => fetchApi<{
        success: true;
        data: RestaurantFollowupPage;
    }>(endpoint(accountId, storeId)),
    binding: (accountId: string, storeId: string, stepId: string, body: {
        expectedVersion: number;
        trigger: RestaurantFollowupTrigger;
        offsetMinutes: number;
        enabled: boolean;
    }) => fetchApi(endpoint(accountId, storeId, '/bindings/' + encodeURIComponent(stepId)), { method: 'PATCH', body: JSON.stringify(body) }),
    addBinding: (accountId: string, storeId: string, stepId: string, body: {
        expectedVersion: number;
        trigger: RestaurantFollowupTrigger;
        offsetMinutes: number;
        enabled: boolean;
    }) => fetchApi(endpoint(accountId, storeId, '/bindings/' + encodeURIComponent(stepId)), { method: 'POST', body: JSON.stringify(body) }),
    deleteBinding: (accountId: string, storeId: string, stepId: string, body: {
        expectedVersion: number;
        trigger: RestaurantFollowupTrigger;
    }) => fetchApi(endpoint(accountId, storeId, '/bindings/' + encodeURIComponent(stepId)), { method: 'DELETE', body: JSON.stringify(body) }),
    requestStart: (accountId: string, storeId: string, expectedVersion: number) => fetchApi<{
        success: true;
        data: {
            approvalId: string;
            sendingStatus: 'pending';
        };
    }>(endpoint(accountId, storeId, '/request-start'), { method: 'POST', body: JSON.stringify({ expectedVersion }) }),
    stop: (accountId: string, storeId: string) => fetchApi(endpoint(accountId, storeId, '/stop'), { method: 'POST' }),
    confirmations: (accountId: string, reservationId: string) => fetchApi<{
        success: true;
        data: RestaurantConfirmation[];
    }>(`/api/restaurant-test/reservations/${encodeURIComponent(reservationId)}/confirmations?account_id=${encodeURIComponent(accountId)}`),
};
