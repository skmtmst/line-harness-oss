// -----------------------------------------------------------------------------
// Stripe イベント (StripeEvent)
// -----------------------------------------------------------------------------

export interface StripeEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  friendId: string | null;
  amount: number | null;
  currency: string | null;
  metadata: string | null;
  processedAt: string;
}
