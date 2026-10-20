export interface BookingEntitlement {
  id: string; line_account_id: string; friend_id: string | null; menu_id: string | null;
  kind: 'ticket' | 'monthly'; name: string; remaining: number | null; monthly_limit: number | null;
  valid_from: string; expires_at: string; status: 'active' | 'revoked'; version: number;
  created_at: string; updated_at: string;
}
export interface BookingEntitlementGrant {
  planId?: string;
  friendId: string; menuId?: string | null; kind: 'ticket' | 'monthly'; name: string;
  remaining?: number; monthlyLimit?: number | null; validFrom: string; expiresAt: string; reason: string;
}
export type BookingEntitlementOperation = { expectedVersion: number; reason: string } & (
  { action: 'adjust'; remaining: number; periodAt?: string } | { action: 'extend'; expiresAt: string } | { action: 'revoke' }
);
export interface BookingEntitlementView extends BookingEntitlement {
  monthUsed: number; monthAllowance: number | null; monthRemaining: number | null; periodStart: string; periodEnd: string;
}
export interface BookingEntitlementEvent {
  id: string; entitlement_id: string; action: 'grant'|'adjust'|'extend'|'revoke'|'consume';
  reason: string; actor_type: 'staff'|'system'; actor_id: string; before_json: string|null;
  after_json: string; request_json: string; created_at: string;
}
