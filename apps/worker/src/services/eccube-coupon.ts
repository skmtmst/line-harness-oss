export type EccubeCouponInput = {
  code: string;
  name: string;
  validFrom: string;
  validTo: string;
  memberOnly?: boolean;
} & (
  | { discountType?: 'price'; discountAmount: number }
  | { discountType: 'rate'; discountRate: number }
);

export async function createEccubeCoupon(
  baseUrl: string,
  secret: string,
  coupon: EccubeCouponInput,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const body = JSON.stringify(coupon);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/line-harness/coupons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nen-Timestamp': timestamp,
      'X-Nen-Signature': `sha256=${signature}`,
    },
    body,
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`EC-CUBE coupon API returned ${response.status}`);
  }
}
