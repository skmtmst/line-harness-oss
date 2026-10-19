/**
 * 受信口の「この通知は本物か」だけを切り出した層。
 *
 * - 鍵の選び方と署名の確かめ方はサービスごとに違うので、その違いをここだけに閉じる。
 * - Uber Eats は公式仕様に合わせる。見出しは `x-uber-signature`、署名は**本文だけ**の
 *   HMAC-SHA256（小文字16進）で、鍵は同じアプリの client_secret。Uber は時刻の見出しを
 *   送らないので、時刻のずれは見ない（見ると本物の通知を落としてしまう）。
 * - 出前館・ロケットナウは自社の方式（`x-nen-timestamp` と `x-nen-signature`）を変えない。
 * - DBも fetch も触らない。設定（env）と文字列だけを見る。
 */
import { NEN_SIGNATURE_HEADER, NEN_TIMESTAMP_HEADER, verifyNenWebhook } from '../lib/hmac.js';
import { deliveryWebhookSecret } from './delivery-webhook-ip.js';
import { uberWebhookSecret } from './restaurant-delivery.js';
import type { DeliveryEnv } from './restaurant-delivery.js';
import type { DeliveryService } from './delivery-service-types.js';
import { UBER_SIGNATURE_HEADER, verifyWebhookSignature } from './uber-eats.js';

/** 自社方式の見出しの名前。Uber 以外のサービスはこの2つを使う。 */
export { NEN_TIMESTAMP_HEADER, NEN_SIGNATURE_HEADER } from '../lib/hmac.js';

/** 受け取った要求の見出しを1つ読む関数。受け口は `c.req.header` をそのまま渡す。 */
export type WebhookHeaderReader = (name: string) => string | null | undefined;

/** 確かめた結果。合わない理由は受け口がそのまま 401 の文にする。 */
export type DeliveryWebhookAuthResult =
  | { ok: true }
  | { ok: false; error: 'Expired request' | 'Invalid signature' };

/**
 * 署名の鍵。
 *
 * Uber だけは静的なトークン用の合言葉ではなく、同じアプリの client_secret を使う
 * （公式仕様。そのため `RT_DELIVERY_UBEREATS_WEBHOOK_SECRET` は Uber では使わない）。
 * 鍵が読めないときは null＝確かめられないので、受け口は受け取らずに設定不足として返す。
 */
export function deliveryWebhookSigningSecret(
  env: DeliveryEnv,
  service: DeliveryService,
): string | null {
  return service === 'ubereats' ? uberWebhookSecret(env) : deliveryWebhookSecret(env, service);
}

/** Uber の方式。本文だけの署名で、時刻の見出しは見ない。 */
async function verifyUberWebhook(
  secret: string,
  rawBody: string,
  header: WebhookHeaderReader,
): Promise<DeliveryWebhookAuthResult> {
  const ok = await verifyWebhookSignature({
    clientSecret: secret,
    rawBody,
    signature: header(UBER_SIGNATURE_HEADER),
  });
  return ok ? { ok: true } : { ok: false, error: 'Invalid signature' };
}

/** 自社の方式。時刻のずれを見てから `${通算秒}.${本文}` の署名を確かめる。 */
async function verifyNenDeliveryWebhook(
  secret: string,
  rawBody: string,
  header: WebhookHeaderReader,
  nowSeconds: number,
): Promise<DeliveryWebhookAuthResult> {
  return verifyNenWebhook({
    profile: 'delivery', secret, rawBody, nowSeconds,
    timestamp: header(NEN_TIMESTAMP_HEADER), signature: header(NEN_SIGNATURE_HEADER),
  });
}

/** サービスごとの方式で、受け取った通知の署名を確かめる。 */
export async function verifyDeliveryWebhook(input: {
  service: DeliveryService;
  secret: string;
  rawBody: string;
  header: WebhookHeaderReader;
  nowSeconds: number;
}): Promise<DeliveryWebhookAuthResult> {
  return input.service === 'ubereats'
    ? verifyUberWebhook(input.secret, input.rawBody, input.header)
    : verifyNenDeliveryWebhook(input.secret, input.rawBody, input.header, input.nowSeconds);
}
