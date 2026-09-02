import { fetchApi } from './api'

export type RestaurantStore = {
  id: string; organization_id: string; name: string; code: string; area: string | null;
  capacity: number; timezone: string; status: 'active' | 'paused' | 'archived';
  line_status: 'connected' | 'warning' | 'error' | 'unconfigured'; google_status: string;
  line_account_id: string | null; line_account_name: string | null; friend_count?: number | null
}
export type RestaurantMembership = {
  id: string; store_id: string | null; staff_name: string; email: string | null; role: 'super_admin' | 'store_manager' | 'staff';
  line_uid: string | null; google_email: string | null; status: string
}
export type RestaurantApproval = {
  id: string; store_id: string | null; kind: 'gbp_post' | 'line_message' | 'menu_change'; title: string;
  status: string; requested_by: string | null; review_comment: string | null; created_at: string
}
export type RestaurantReservation = {
  id: string; store_id: string; store_name: string; source: string; external_id: string | null;
  customer_name: string; customer_phone: string | null; line_uid: string | null; guest_count: number;
  starts_at: string; ends_at: string; table_id: string | null; table_label: string | null;
  course_id: string | null; course_name: string | null; status: string; allergy_note: string | null; note: string | null;
  sync_direction: 'inbound_only'
}
export type RestaurantTable = {
  id: string; store_id: string; code: string; label: string; seat_type: string; min_capacity: number;
  max_capacity: number; floor_x: number; floor_y: number; join_group: string | null; is_active: number
}
export type RestaurantInventory = {
  id: string; store_id: string; starts_at: string; slot_minutes: 15 | 30; total_capacity: number;
  ota_capacity: number; line_capacity: number; walk_in_capacity: number; reserved_count: number
}
export type RestaurantMenuItem = {
  id: string; store_id: string; kind: 'course' | 'a_la_carte'; name: string; price: number;
  tax_mode: string; allergens_json: string; service_periods_json: string; duration_minutes: number | null; status: string
}
export type RestaurantConnector = {
  id: string; store_id: string; provider: string; mode: 'disabled' | 'inbound_only'; status: string;
  last_synced_at: string | null; last_error: string | null
}
export type RestaurantReview = {
  id: string; store_id: string; author_name: string | null; rating: number; comment: string | null;
  reviewed_at: string; reply_status: string; reply_draft: string | null; sentiment: string | null
}
export type RestaurantPost = {
  id: string; store_id: string; post_type: string; title: string; body: string; status: string; scheduled_at: string | null
}
export type RestaurantLineFlow = {
  id: string; store_id: string | null; flow_type: string; title: string; body: string;
  timing_minutes: number | null; is_enabled: number; delivery_mode: 'preview_only' | 'disabled'
}
export type RestaurantIntakeAddress = {
  id: string; storeId: string; localPart: string; address: string; status: 'active';
  createdAt: string; revokedAt: string | null
}
export type RestaurantTermsAgreement = {
  documentKey: string; agreedVersion: string | null; agreedAt: string | null
}

export type RestaurantSnapshot = {
  environment: 'staging_test'; integrationPolicy: 'inbound_only';
  organization: {
    id: string; account_id: string; tenant_id: string | null; tenant_name: string | null;
    name: string; status: string
  } | null;
  stores: RestaurantStore[]; memberships: RestaurantMembership[]; approvals: RestaurantApproval[];
  reservations: RestaurantReservation[]; tables: RestaurantTable[]; inventory: RestaurantInventory[];
  menuItems: RestaurantMenuItem[]; connectors: RestaurantConnector[]; reviews: RestaurantReview[];
  posts: RestaurantPost[]; lineFlows: RestaurantLineFlow[]
}

const withAccount = (path: string, accountId: string) =>
  `${path}${path.includes('?') ? '&' : '?'}account_id=${encodeURIComponent(accountId)}`

const withOptionalAccount = (path: string, accountId: string | null) =>
  accountId ? withAccount(path, accountId) : path

export const restaurantTestApi = {
  listStores: (accountId: string) => fetchApi<{ success: true; data: { organization: RestaurantSnapshot['organization']; stores: RestaurantStore[] } }>(withAccount('/api/restaurant-test/stores', accountId)),
  storeContext: (accountId: string) => fetchApi<{ success: true; data: { selectedStore: { id: string; name: string } | null } }>(withAccount('/api/restaurant-test/store-context', accountId)),
  selectStore: (accountId: string, storeId: string) => fetchApi<{ success: true; data: { selectedStore: { id: string; name: string } } }>(withAccount(`/api/restaurant-test/stores/${storeId}/select`, accountId), { method: 'POST', body: '{}' }),
  clearStoreSelection: (accountId: string) => fetchApi<{ success: true; data: { selectedStore: null } }>(withAccount('/api/restaurant-test/stores/selection/clear', accountId), { method: 'POST', body: '{}' }),
  connectStore: (accountId: string | null, body: { name: string; alias: string; channelId: string; channelSecret: string }) => fetchApi<{ success: true; data: { store: { id: string; name: string }; lineAccountName: string } }>(withOptionalAccount('/api/restaurant-test/stores/connect', accountId), { method: 'POST', body: JSON.stringify(body) }),
  termsAgreement: (accountId: string | null) => fetchApi<{ success: true; data: RestaurantTermsAgreement }>(withOptionalAccount('/api/restaurant-test/terms-agreement', accountId)),
  agreeToTerms: (accountId: string | null, documentKey: string, version: string) => fetchApi<{ success: true; data: RestaurantTermsAgreement }>(withOptionalAccount('/api/restaurant-test/terms-agreement', accountId), { method: 'POST', body: JSON.stringify({ documentKey, version }) }),
  snapshot: (accountId: string) => fetchApi<{ success: true; data: RestaurantSnapshot }>(withAccount('/api/restaurant-test/snapshot', accountId)),
  createStore: (accountId: string, body: { name: string; code: string; area: string; capacity: number; timezone: string; lineAccountId: string }) => fetchApi<{ success: true; data: { id: string } }>(withAccount('/api/restaurant-test/stores', accountId), { method: 'POST', body: JSON.stringify(body) }),
  updateStore: (accountId: string, id: string, body: { name: string; code: string; area: string; capacity: number; status: RestaurantStore['status']; lineAccountId: string }) => fetchApi<{ success: true; data: { id: string } }>(withAccount(`/api/restaurant-test/stores/${id}`, accountId), { method: 'PATCH', body: JSON.stringify(body) }),
  listIntakeAddresses: (accountId: string, storeId: string) => fetchApi<{ success: true; data: RestaurantIntakeAddress[] }>(withAccount(`/api/restaurant-test/intake-addresses?storeId=${encodeURIComponent(storeId)}`, accountId)),
  issueIntakeAddress: (accountId: string, storeId: string) => fetchApi<{ success: true; data: { id: string; storeId: string; localPart: string; address: string; graceDays: number } }>(withAccount('/api/restaurant-test/intake-addresses', accountId), { method: 'POST', body: JSON.stringify({ storeId }) }),
  decideApproval: (accountId: string, id: string, action: 'approve' | 'return', comment?: string) => fetchApi(withAccount(`/api/restaurant-test/approvals/${id}`, accountId), { method: 'PATCH', body: JSON.stringify({ action, comment }) }),
  createReservation: (accountId: string, body: Record<string, unknown>) => fetchApi(withAccount('/api/restaurant-test/reservations/manual', accountId), { method: 'POST', body: JSON.stringify(body) }),
  importReservation: (accountId: string, body: Record<string, unknown>) => fetchApi(withAccount('/api/restaurant-test/inbound/reservations', accountId), { method: 'POST', body: JSON.stringify(body) }),
  createTable: (accountId: string, body: Record<string, unknown>) => fetchApi(withAccount('/api/restaurant-test/tables', accountId), { method: 'POST', body: JSON.stringify(body) }),
  createMembership: (accountId: string, body: Record<string, unknown>) => fetchApi(withAccount('/api/restaurant-test/memberships', accountId), { method: 'POST', body: JSON.stringify(body) }),
  updateInventory: (accountId: string, id: string, body: Record<string, unknown>) => fetchApi(withAccount(`/api/restaurant-test/inventory/${id}`, accountId), { method: 'PUT', body: JSON.stringify(body) }),
  createMenu: (accountId: string, body: Record<string, unknown>) => fetchApi(withAccount('/api/restaurant-test/menu', accountId), { method: 'POST', body: JSON.stringify(body) }),
  createGbpPost: (accountId: string, body: Record<string, unknown>) => fetchApi(withAccount('/api/restaurant-test/gbp/posts', accountId), { method: 'POST', body: JSON.stringify(body) }),
  updateReviewDraft: (accountId: string, id: string, replyDraft: string) => fetchApi(withAccount(`/api/restaurant-test/gbp/reviews/${id}/draft`, accountId), { method: 'PUT', body: JSON.stringify({ replyDraft }) }),
  updateLineFlow: (accountId: string, id: string, body: Record<string, unknown>) => fetchApi(withAccount(`/api/restaurant-test/line-flows/${id}`, accountId), { method: 'PUT', body: JSON.stringify(body) }),
}
