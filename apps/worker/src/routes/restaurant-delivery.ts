import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { deliveryAccessGuard } from './restaurant-delivery-common.js';
import { registerDeliveryOrderReads } from './restaurant-delivery-orders-read.js';
import { registerDeliveryOrderActions } from './restaurant-delivery-orders-actions.js';
import { registerDeliveryHistory } from './restaurant-delivery-history.js';
import { registerDeliveryControls } from './restaurant-delivery-controls.js';
import { registerDeliveryWebhooks } from './restaurant-delivery-webhooks.js';
import { registerDeliveryUber } from './restaurant-delivery-uber.js';

/** 飲食店の受注は Uber Eats・出前館・ロケットナウの公式 API へ直接接続する。menu はサービス終了のため対象外。店舗はアカウントと担当者の統括から解決する。送信はサービス層へ分けて先に台帳を作り、成功後だけ状態を進める。外部の本文・例外は出さず分類済み符号だけを残す。急ぎ度はサーバーで決め、画面には結果と理由だけを返す。設計図 kDQHr・hjdqV・dgeTy・OzHLO・h7OeT・XCVGd と照合する。 */

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
