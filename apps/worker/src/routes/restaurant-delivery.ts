import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { deliveryAccessGuard } from './restaurant-delivery-common.js';
import { registerDeliveryOrderReads } from './restaurant-delivery-orders-read.js';
import { registerDeliveryOrderActions } from './restaurant-delivery-orders-actions.js';
import { registerDeliveryHistory } from './restaurant-delivery-history.js';
import { registerDeliveryControls } from './restaurant-delivery-controls.js';
import { registerDeliveryWebhooks } from './restaurant-delivery-webhooks.js';
import { registerDeliveryUber } from './restaurant-delivery-uber.js';

/**
 * 飲食店向け（テスト）「デリバリー受注」。
 *
 * 設計正本：`/Users/masatosakamoto/Documents/LINE-Harness-Design/新規デザイン/2026-10-09_デリバリー管理_デリバリー受注/デリバリー受注_v02.pen`
 * 利用者承認：2026-10-09「承認します。実装を進めてください。」
 * 対象フレーム：D-1 `kDQHr`（一覧）/ D-2 `hjdqV`（詳細）/ D-3 `dgeTy`（キャンセル）/
 *   D-4 `OzHLO`（履歴・CSV）/ D-5 `h7OeT`（品切れ一括）/ D-6 `XCVGd`（受付一括停止）。
 *
 * - 対象サービスは Uber Eats・出前館・ロケットナウの3つ（menu は2026-09-30終了のため対象外）。
 * - 外部の受注一元化サービス（Camel等）との契約・通信はない。各サービスの公式窓口から
 *   自社Workerが直接受け取り、各サービスのAPIへ直接送る。画面にその種の名称は出さない。
 * - 店舗は必ず account_id → rt_stores.line_account_id と担当者の統括（tenant）で引く。
 * - 各サービスへの送信は services/restaurant-delivery.ts に閉じ込め、この層はDBと権限だけを扱う。
 * - 送信は必ず `rt_delivery_dispatches` へ先に記録し、成功した時だけ注文・商品・受付の状態を進める。
 * - 失敗は分類済みの符号だけを残す。サービスから返った自由文・本文・例外は保存も表示もしない。
 * - 急ぎ度はバックエンドだけで判定し、画面には結果と理由の文だけを出す（仕組みの名称は出さない）。
 */

export { deliveryAccessGuard } from './restaurant-delivery-common.js';
export type { DeliveryOrderRow, DeliveryOrderItemRow, DeliveryServiceStateRow, DeliveryMenuItemRow } from './restaurant-delivery-types.js';

export const restaurantDelivery = new Hono<Env>();
restaurantDelivery.use('/api/restaurant-test/delivery/*', deliveryAccessGuard);
registerDeliveryOrderReads(restaurantDelivery);
registerDeliveryOrderActions(restaurantDelivery);
registerDeliveryHistory(restaurantDelivery);
registerDeliveryControls(restaurantDelivery);
registerDeliveryWebhooks(restaurantDelivery);
registerDeliveryUber(restaurantDelivery);
