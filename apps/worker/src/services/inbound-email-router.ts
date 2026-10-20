import { logger } from '@line-crm/shared/server';
import type { Env } from '../worker-env.js';
import { restaurantTestEnabled } from '../lib/environment-features.js';
import { isRestaurantIntakeRecipient, receiveRestaurantIntakeEmail } from './restaurant-email-intake.js';
import { receiveSupportEmail } from './support-email.js';

type InboundEmailHandlers = {
  receiveRestaurantIntakeEmail: typeof receiveRestaurantIntakeEmail;
  receiveSupportEmail: typeof receiveSupportEmail;
};

const defaultHandlers: InboundEmailHandlers = {
  receiveRestaurantIntakeEmail,
  receiveSupportEmail,
};

/** 飲食店向けcatch-allと既存サポート受信を、宛先ローカル部で分離する。 */
export async function routeInboundEmail(
  message: ForwardableEmailMessage,
  env: Env['Bindings'],
  handlers: InboundEmailHandlers = defaultHandlers,
): Promise<void> {
  if (isRestaurantIntakeRecipient(message.to)) {
    if (!restaurantTestEnabled(env)) {
      message.setReject('予約メール受信は現在利用できません');
      return;
    }
    try {
      await handlers.receiveRestaurantIntakeEmail(message, env);
    } catch (error) {
      logger.error("restaurant_email_receive_failed");
      message.setReject('予約メール受信処理に失敗しました');
    }
    return;
  }

  // r- 以外は従来のサポートメール受信をそのまま使う。
  try {
    await handlers.receiveSupportEmail(message, env);
  } catch (error) {
    logger.error("support_email_receive_failed");
    message.setReject('メール受信処理に失敗しました');
  }
}
