import { type TenantPlanStatus } from '@line-crm/db';

export function mapStripeSubscriptionStatus(status: string): TenantPlanStatus | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'incomplete':
      return null;
    default:
      // canceled / incomplete_expired / paused
      return 'canceled';
  }
}
