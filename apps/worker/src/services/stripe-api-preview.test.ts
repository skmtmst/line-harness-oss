import { describe, expect, it, vi } from 'vitest';
import { stripeApi } from './stripe-api.js';

describe('Stripe invoice preview request', () => {
  it('請求書の見積りだけへ、即時の日割り条件を送る', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await stripeApi.createInvoicePreview({ STRIPE_SECRET_KEY: 'sk_test_mock' }, { subscriptionId: 'sub_1', itemId: 'si_1', priceId: 'price_1', quantity: 2, prorationDate: 1790899200 }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/invoices/create_preview');
    expect(init.method).toBe('POST');
    expect(init.headers['Stripe-Version']).toBe('2024-06-20');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      subscription: 'sub_1', 'subscription_details[items][0][id]': 'si_1',
      'subscription_details[items][0][price]': 'price_1', 'subscription_details[items][0][quantity]': '2',
      'subscription_details[proration_behavior]': 'create_prorations', 'subscription_details[proration_date]': '1790899200',
    });
  });
});
