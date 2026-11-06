export type OrganizationRow = {
  id: string;
  account_id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  name: string;
  status: string;
};

export type OrganizationContext = OrganizationRow & { scopedStoreId: string | null };

export type RestaurantStoreRow = {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  area: string | null;
  capacity: number;
  timezone: string;
  status: 'active' | 'paused' | 'archived';
  line_status: 'connected' | 'warning' | 'error' | 'unconfigured';
  google_status: string;
  line_account_id: string | null;
  line_account_name: string | null;
  friend_count?: number | null;
  created_at: string;
  updated_at: string;
};

export type SelectedRestaurantStore = {
  id: string;
  organization_id: string;
  name: string;
};

export interface SeatWaitlistEntryLike {
  hold_expires_at:string|null;
  table_id:string|null;
  line_uid:string|null;
  customer_phone:string|null;
  store_id: string;
  starts_at: string;
  guest_count: number;
  status: string;
}
