export type TenantStatus = 'active' | 'suspended' | 'archived';

export type TenantListRow = {
  id: string;
  name: string;
  status: TenantStatus;
  feature_packs: string;
  plan_key: string | null;
  plan_status: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  created_at: string;
  updated_at: string;
  account_count: number;
  staff_count: number;
  last_login_at: string | null;
};
