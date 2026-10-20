import { logger } from '@line-crm/shared/server';


/**
 * 送り先の `event_types` を読む(#506 中)。
 *
 * 1行でも壊れていると一覧全体が例外→500になっていた。壊れた行は空に
 * 落とし、IDを構造化ログに残して一覧は返す。配列でないJSON(文字列など)
 * も同じ扱いにする。
 */
export function outgoingEventTypes(raw: string | null | undefined, webhookId: string): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error('event_types is not an array');
    return parsed.map((entry) => String(entry));
  } catch {
    logger.error("outgoing_webhook_event_types_broken");
    return [];
  }
}
