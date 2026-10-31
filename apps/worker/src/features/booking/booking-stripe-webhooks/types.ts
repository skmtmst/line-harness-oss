export const STRIPE_BOOKING_API_VERSION = '2024-06-20';
export const RECEIPT_PROCESS = 'booking_stripe_webhook';
export const BINDING_PROCESS = 'booking_stripe_object';
export type StripeBookingPurpose = 'monthly_invoice' | 'payment_method' | 'pass_purchase' | 'booking_payment' | 'cancellation_charge' | 'restaurant_payment';
export interface BookingStripeEvent {
  id: string; account: string; type: string; apiVersion: string; created: number;
  object: { id: string; kind: string; status: string | null; paymentStatus: string | null;
    amount: number | null; amountPaid: number | null; amountRemaining: number | null; amountReceived: number | null;
    paidOutOfBand: boolean | null; autoAdvance: boolean | null; currency: string | null; customer: string | null;
    paymentMethod: string | null; setupIntent: string | null; checkoutMode: string | null; paymentIntent: string | null; subscription: string | null;
    periodStart: number | null; periodEnd: number | null };
}
/** 外部IDを保存する側が、業務の行と同じbatchで固定する。HTTP入力から作らない。 */
export interface BookingStripeBinding {
  tenantId: string; accountId: string; friendId: string; purpose: StripeBookingPurpose;
  targetId: string; connectAccount: string; objectId: string; objectKind: string;
  amount: number | null; currency: string | null; customerId: string;
}
export interface StripeReceiptInput {
  digest: string; event: BookingStripeEvent;
  retentionAccountId: string | null; retentionTenantId: string | null;
}
export class BookingStripeError extends Error {
  constructor(public code: string, public status: 400 | 401 | 409 | 413 | 503 = 409) { super(code); }
}

export const BOOKING_STRIPE_EVENT_KINDS: Readonly<Record<string, readonly string[]>> = {
  invoice: ['invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided','invoice.finalized'],
  setup_intent: ['setup_intent.succeeded','setup_intent.setup_failed','setup_intent.canceled'],
  'checkout.session': ['checkout.session.completed','checkout.session.expired'],
  payment_intent: ['payment_intent.succeeded','payment_intent.payment_failed','payment_intent.processing','payment_intent.canceled'],
};
export function supportedBookingStripeType(type: unknown): boolean {
  return typeof type==='string' && Object.values(BOOKING_STRIPE_EVENT_KINDS).some(kinds=>kinds.includes(type));
}
