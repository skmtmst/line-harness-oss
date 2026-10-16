/**
 * 配送手配（誰が運ぶか）の差し替え口。
 *
 * 2026-10-10 に利用者が事前共有したフェーズ2（LINE自社デリバリー受注＋配送アグリゲーション）の
 * 受け皿。ここは**口（インターフェース）と選び方**だけで、外部への通信は一切書かない。
 * Uber Direct を足すときはこの口を満たす実装を1ファイル増やすだけで済み、
 * 次に Wolt Drive を足すときも同じ。呼び出し側（注文の保存・画面・Cron）は変えない。
 *
 * 受注（どこから注文が来たか）と配送手配（誰が運ぶか）は別の軸として扱う。
 * - 受注: `DeliveryService`（Uber Eats・出前館・ロケットナウ）＋ LINE直受け
 * - 配送: ここの `DeliveryProvider`
 * 外部サービス経由の注文はそのサービスの配達員が運ぶので手配は要らない。手配が要るのは
 * LINEから直接受けた注文だけ。
 *
 * 約束事
 * - 時刻は **エポック秒**（`rt_delivery_*` と同じ単位）。ミリ秒を混ぜない。
 * - 金額は **円の整数**。小数を持ち込まない。
 * - 相手から返った自由文・本文・例外は返さない。分類済みの符号と、運用者向けの
 *   日本語の一文だけを返す（`restaurant-delivery.ts` と同じ約束）。
 */
import type { SafeExternalDeliveryError } from './external-delivery-retry.js';

/** 配送を外部へ委託できる業者。実装を足す順番は Uber Direct → Wolt Drive。 */
export const DELIVERY_DISPATCH_PROVIDERS = ['uber_direct', 'wolt_drive'] as const;
export type DeliveryDispatchProviderId = (typeof DELIVERY_DISPATCH_PROVIDERS)[number];

/**
 * 注文表 `rt_delivery_orders.delivery_provider` に入る値の全部。
 * 'service' はそのサービスの配達員（既存の3サービス）、'store' は店舗が自分で運ぶ。
 * 移行 637 の CHECK と同じ並びを保つ。
 */
export const DELIVERY_PROVIDERS = [
  'service',
  'store',
  ...DELIVERY_DISPATCH_PROVIDERS,
] as const;
export type DeliveryProvider = (typeof DELIVERY_PROVIDERS)[number];

export const DELIVERY_PROVIDER_LABELS: Record<DeliveryProvider, string> = {
  service: 'サービスの配達員',
  store: '店舗が自分で配達',
  uber_direct: 'Uber Direct',
  wolt_drive: 'Wolt Drive',
};

export function isDeliveryProvider(value: unknown): value is DeliveryProvider {
  return typeof value === 'string' && (DELIVERY_PROVIDERS as readonly string[]).includes(value);
}

export function isDeliveryDispatchProviderId(
  value: unknown,
): value is DeliveryDispatchProviderId {
  return (
    typeof value === 'string'
    && (DELIVERY_DISPATCH_PROVIDERS as readonly string[]).includes(value)
  );
}

/** 配達の受け取り先・届け先。住所の自由文は持たせず、座標と必要な連絡事項だけ。 */
export type DeliveryDispatchPlace = {
  latitude: number;
  longitude: number;
  /** 建物名・部屋番号など、配達員への補足。無ければ null。 */
  note: string | null;
};

export type DeliveryDispatchQuoteRequest = {
  storeId: string;
  pickup: DeliveryDispatchPlace;
  dropoff: DeliveryDispatchPlace;
  /** 商品の合計（円）。保険の申告や下限の判定に使う。 */
  orderAmount: number;
  /** 受け取り希望のエポック秒。すぐなら null。 */
  wantedAt: number | null;
  /** 判定の基準時刻（エポック秒）。試験で時計を固定するため必ず渡す。 */
  nowSec: number;
};

export type DeliveryDispatchQuote = {
  provider: DeliveryDispatchProviderId;
  /** この業者に払う配送実費（円）。これが手数料との比較の軸になる。 */
  feeAmount: number;
  /** 届くまでの見込み（分）。 */
  etaMinutes: number;
  /** 見積りの有効期限（エポック秒）。過ぎた見積りで手配しない。 */
  expiresAtSec: number;
  /** 業者側の見積り識別子。手配のときにそのまま渡す。 */
  quoteReference: string;
};

/** 手配が成立したときに注文表へ書き戻す内容。 */
export type DeliveryDispatchAccepted = {
  provider: DeliveryDispatchProviderId;
  /** `rt_delivery_orders.delivery_tracking_id` に入れる値。 */
  trackingId: string;
  feeAmount: number;
  etaMinutes: number;
};

/**
 * 相手の都合で運べない場合。業者が見つからないのは**失敗ではなく通常の結果**なので、
 * 例外にせず結果として返す。呼び出し側はここで次の業者を試すか、返金へ進む。
 */
export type DeliveryDispatchUnavailable = {
  /** 'no_courier' 配達員が居ない / 'out_of_area' 範囲外 / 'closed' 時間外 / 'too_small' 下限未満 */
  reason: 'no_courier' | 'out_of_area' | 'closed' | 'too_small';
  message: string;
};

export type DeliveryDispatchResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'unavailable'; detail: DeliveryDispatchUnavailable }
  | { ok: false; kind: 'error'; detail: SafeExternalDeliveryError };

/**
 * 1業者ぶんの口。外部通信・鍵の取り回しは各実装の中に閉じ込める。
 * 例外を投げず、必ず `DeliveryDispatchResult` を返す。
 */
export interface DeliveryDispatchProvider {
  readonly id: DeliveryDispatchProviderId;
  /** いくらで何分で運べるかを尋ねる。手配はしない。 */
  quote(request: DeliveryDispatchQuoteRequest): Promise<DeliveryDispatchResult<DeliveryDispatchQuote>>;
  /** 見積りを手配として確定する。 */
  create(
    request: DeliveryDispatchQuoteRequest,
    quote: DeliveryDispatchQuote,
  ): Promise<DeliveryDispatchResult<DeliveryDispatchAccepted>>;
  /** 手配を取り消す。取り消し済みでも成功として返す（二重取り消しで止めない）。 */
  cancel(trackingId: string): Promise<DeliveryDispatchResult<null>>;
}

export type DeliveryDispatchRegistry = {
  /** 使える業者のID。優先順は登録順。 */
  readonly ids: readonly DeliveryDispatchProviderId[];
  get(id: DeliveryDispatchProviderId): DeliveryDispatchProvider | null;
};

/**
 * 使える業者を束ねる。同じIDを二重に登録したら作る時点で止める
 * （運用中に黙ってどちらかが無視されるのを防ぐ）。
 */
export function createDeliveryDispatchRegistry(
  providers: readonly DeliveryDispatchProvider[],
): DeliveryDispatchRegistry {
  const map = new Map<DeliveryDispatchProviderId, DeliveryDispatchProvider>();
  for (const provider of providers) {
    if (map.has(provider.id)) {
      throw new Error(`duplicate delivery dispatch provider: ${provider.id}`);
    }
    map.set(provider.id, provider);
  }
  return {
    ids: [...map.keys()],
    get: (id) => map.get(id) ?? null,
  };
}

/**
 * 集めた見積りから1つ選ぶ。安い順、同額なら早い順、それも同じなら登録順。
 * 期限切れの見積りは使わない。
 *
 * 「自社で運ぶ方が得か、サービスに任せる方が得か」の判断に使う基準額や手数料率は
 * ここに埋め込まない。店舗ごとの設定（`rt_store_feature_flags.config_json`）から
 * 呼び出し側が渡す。基準が変わるたびにこの関数を直さずに済ませるため。
 */
export function selectDeliveryDispatchQuote(
  quotes: readonly DeliveryDispatchQuote[],
  options: { nowSec: number; priority?: readonly DeliveryDispatchProviderId[] },
): DeliveryDispatchQuote | null {
  const priority = options.priority ?? DELIVERY_DISPATCH_PROVIDERS;
  const rank = (id: DeliveryDispatchProviderId) => {
    const index = priority.indexOf(id);
    return index < 0 ? priority.length : index;
  };
  const usable = quotes.filter((quote) => quote.expiresAtSec > options.nowSec);
  if (usable.length === 0) return null;
  return usable.reduce((best, quote) => {
    if (quote.feeAmount !== best.feeAmount) return quote.feeAmount < best.feeAmount ? quote : best;
    if (quote.etaMinutes !== best.etaMinutes) return quote.etaMinutes < best.etaMinutes ? quote : best;
    return rank(quote.provider) < rank(best.provider) ? quote : best;
  });
}
