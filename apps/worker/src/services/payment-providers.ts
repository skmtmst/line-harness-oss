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
  | { providerPaymentId: string; status: 'paid' | 'failed' }
  | null;

export interface PaymentProvider {
  name: string;
  startPayment(input: PaymentStartInput): Promise<PaymentStartResult>;
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
  data?: { object?: { id?: unknown } };
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
      const providerPaymentId = String(event?.data?.object?.id ?? '');
      if (!providerPaymentId) return null;
      if (event.type === 'payment_intent.succeeded') {
        return { providerPaymentId, status: 'paid' };
      }
      if (event.type === 'payment_intent.payment_failed') {
        return { providerPaymentId, status: 'failed' };
      }
      return null;
    },
  };
}

registerPaymentProvider(noneProvider);
registerPaymentProvider(onsiteProvider);
