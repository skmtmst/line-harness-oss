import { safeReceiptUrl } from '../features/booking/booking-payment-history/index.js';
import { verifyStripeSignature } from './stripe-signature.js';
import type { BookingPaymentStatus } from '@line-crm/db';

/**
 * 決済サービスを差し替えられる作りの差し込み口。
 *
 * 新しいサービスは PaymentProvider を作って registerPaymentProvider に
 * 1行足すだけ。予約の流れ・画面は触らない。
 * 鍵は引数で渡す（コード・試験・DBに書かない）。
 */

export interface PaymentStartInput {
  amount: number;
  currency: string;
  bookingId: string;
  idempotencyKey: string;
  returnUrl?: string | null;
}

export interface PaymentStartResult {
  /** 決済画面のURL。店頭・不要なら null。 */
  checkoutUrl: string | null;
  /** 相手側のID。まだ無いときは null。 */
  providerPaymentId: string | null;
}

export type WebhookOutcome =
  | { providerPaymentId: string; status: 'paid' | 'failed' | 'refunded' | 'expired';
      providerEventId?: string; amount?: number; currency?: string; receiptUrl?: string; refundedAmount?: number }
  | null;

export interface PaymentProvider {
  name: string;
  startPayment(input: PaymentStartInput): Promise<PaymentStartResult>;
  /** 既存の決済画面を取得する。新しい決済・有効期限の延長は行わない。 */
  getCheckoutUrl?(input: { providerPaymentId: string; idempotencyKey: string }): Promise<string | null>;
  /**
   * 相手側の状態を聞く。外へ通信できない試験時は 'unknown' を返し、
   * 知らせ（webhook）で進める。
   */
  getStatus(providerPaymentId: string): Promise<BookingPaymentStatus | 'unknown'>;
  refund(providerPaymentId: string, amount?: number): Promise<boolean>;
  verifyWebhook(rawBody: string, signature: string): Promise<WebhookOutcome>;
}

const registry = new Map<string, PaymentProvider>();

export function registerPaymentProvider(provider: PaymentProvider): void {
  registry.set(provider.name, provider);
}

export function getPaymentProvider(name: string): PaymentProvider | null {
  return registry.get(name) ?? null;
}

export function registeredProviderNames(): string[] {
  return [...registry.keys()];
}

const noneProvider: PaymentProvider = {
  name: 'none',
  async startPayment() {
    return { checkoutUrl: null, providerPaymentId: null };
  },
  async getStatus() {
    return 'unknown';
  },
  async refund() {
    return false;
  },
  async verifyWebhook() {
    return null;
  },
};

const onsiteProvider: PaymentProvider = {
  name: 'onsite',
  async startPayment() {
    // 店頭で払うので決済画面は無い。記録だけ残して予約は今までどおり進む。
    return { checkoutUrl: null, providerPaymentId: null };
  },
  async getStatus() {
    return 'unknown';
  },
  async refund() {
    // 店頭の返金はレジの仕事。ここでは記録しない。
    return false;
  },
  async verifyWebhook() {
    return null;
  },
};

export interface StripeTestSecrets {
  webhookSecret: string;
}

interface StripeTestEvent {
  id?: unknown;
  type?: unknown;
  livemode?: unknown;
  data?: { object?: { id?: unknown; payment_intent?: unknown; amount?: unknown; amount_refunded?: unknown;
    currency?: unknown; receipt_url?: unknown } };
}

/**
 * Stripe のテストモード。外へ通信しない。
 * 始める→知らせ→支払い済みの順に進み、署名は本物と同じ形で確かめる。
 */
export function createStripeTestProvider(secrets: StripeTestSecrets): PaymentProvider {
  return {
    name: 'stripe',
    async startPayment(input: PaymentStartInput) {
      return {
        checkoutUrl: `https://checkout.stripe.com/test/pay/${input.idempotencyKey}`,
        providerPaymentId: `pi_test_${input.idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`,
      };
    },
    async getCheckoutUrl(input) {
      const expectedId = `pi_test_${input.idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
      return input.providerPaymentId === expectedId
        ? `https://checkout.stripe.com/test/pay/${input.idempotencyKey}`
        : null;
    },
    async getStatus() {
      // 試験時は外を見に行かず、知らせで進める。
      return 'unknown';
    },
    async refund() {
      // 試験時は返金を記録上だけ成功にする。お金は動かない。
      return true;
    },
    async verifyWebhook(rawBody: string, signature: string) {
      if (!secrets.webhookSecret || secrets.webhookSecret.length < 8) return null;
      if (!(await verifyStripeSignature(secrets.webhookSecret, rawBody, signature))) return null;
      let event: StripeTestEvent;
      try {
        event = JSON.parse(rawBody) as StripeTestEvent;
      } catch {
        return null;
      }
      if (event.livemode !== undefined && event.livemode !== false) return null;
      const object = event?.data?.object;
      const providerPaymentId = event.type === 'charge.refunded' || event.type === 'charge.succeeded' || event.type === 'checkout.session.expired'
        ? object?.payment_intent : object?.id;
      if (typeof providerPaymentId !== 'string' || !providerPaymentId || providerPaymentId.length > 255) return null;
      if (event.id !== undefined && (typeof event.id !== 'string' || !event.id || event.id.length > 255)) return null;
      if (object?.amount !== undefined && (!Number.isSafeInteger(object.amount) || (object.amount as number) < 0)) return null;
      if (object?.currency !== undefined && (typeof object.currency !== 'string' || !/^[a-z]{3}$/i.test(object.currency))) return null;
      const metadata = { providerEventId: event.id as string | undefined, amount: object?.amount as number | undefined,
        currency: object?.currency as string | undefined, receiptUrl: safeReceiptUrl(typeof object?.receipt_url==='string' ? object.receipt_url : null) ?? undefined };
      if ((event.type === 'payment_intent.succeeded' || event.type === 'charge.succeeded')) {
        return { providerPaymentId, status: 'paid', ...metadata };
      }
      if (event.type === 'payment_intent.payment_failed') {
        return { providerPaymentId, status: 'failed', ...metadata };
      }
      // Stripeの返金通知は返金の累計額。順不同・再送でも二重に減らさない。
      if (event.type === 'charge.refunded' && typeof object?.amount === 'number'
        && Number.isSafeInteger(object.amount_refunded) && Number(object.amount_refunded)>0 && Number(object.amount_refunded)<=object.amount) {
        const receiptUrl = metadata.receiptUrl;
        return { providerPaymentId, status: 'refunded', ...metadata, receiptUrl, refundedAmount: object.amount_refunded as number };
      }
      if (event.type === 'checkout.session.expired') return { providerPaymentId, status: 'expired', ...metadata };
      return null;
    },
  };
}

registerPaymentProvider(noneProvider);
registerPaymentProvider(onsiteProvider);
