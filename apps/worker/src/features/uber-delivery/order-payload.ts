import type { WebhookOrder } from '../../services/delivery-webhook-payload.js';

const MAX_ITEMS = 100;
const MAX_ITEM_NOTE_LENGTH = 200;
const MAX_CUSTOMER_NOTE_LENGTH = 500;
const MAX_MONEY = 10_000_000;
const ORDER_STATES = new Set(['CREATED', 'ACCEPTED', 'DENIED', 'FINISHED', 'CANCELED', 'UNKNOWN']);
export type UberOrderState = 'CREATED' | 'ACCEPTED' | 'DENIED' | 'FINISHED' | 'CANCELED' | 'UNKNOWN';
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

type JsonObject = Record<string, unknown>;

export interface UberNotification {
  eventId: string;
  eventType: string;
  orderId: string;
  uberStoreId: string;
  kind: 'order' | 'cancel' | 'ignored';
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return text(value, max) ?? undefined;
}

function positiveInteger(value: unknown, max: number): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max
    ? Number(value)
    : null;
}

function money(value: unknown): number | null {
  const source = object(value);
  if (!source || source.currency_code !== 'JPY') return null;
  const amount = source.amount;
  return Number.isSafeInteger(amount) && Number(amount) >= 0 && Number(amount) <= MAX_MONEY
    ? Number(amount)
    : null;
}

function isoEpoch(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value)) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined;
}

function eventKind(eventType: string): UberNotification['kind'] {
  if (eventType === 'orders.notification') return 'order';
  if (eventType === 'orders.cancel' || eventType === 'orders.failure') return 'cancel';
  return 'ignored';
}

export function parseUberNotification(
  raw: unknown,
): { ok: true; notification: UberNotification } | { ok: false; error: string } {
  const source = object(raw);
  const meta = object(source?.meta);
  const eventId = text(source?.event_id, 128);
  const eventType = text(source?.event_type, 64);
  const orderId = text(meta?.resource_id, 128);
  const uberStoreId = text(meta?.user_id, 128);
  if (!eventId || !eventType || !orderId || !uberStoreId) {
    return { ok: false, error: 'Invalid Uber notification' };
  }
  return {
    ok: true,
    notification: { eventId, eventType, orderId, uberStoreId, kind: eventKind(eventType) },
  };
}

function list(value: unknown, max: number): unknown[] | null {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) && value.length <= max ? value : null;
}

function allergyNote(value: unknown): string | null | undefined {
  const source = object(value);
  if (!source) return undefined;
  const allergens = list(source.allergens_to_exclude, 20);
  if (!allergens) return undefined;
  const labels: string[] = [];
  for (const entry of allergens) {
    const allergen = object(entry);
    const type = text(allergen?.type, 32);
    if (!type) return undefined;
    const freeform = optionalText(allergen?.freeform_text, 100);
    if (freeform === undefined) return undefined;
    labels.push(freeform ? `${type} (${freeform})` : type);
  }
  const instructions = optionalText(source.allergy_instructions, 200);
  if (instructions === undefined) return undefined;
  if (labels.length === 0 && !instructions) return null;
  return [...labels, instructions].filter(Boolean).join(', ');
}

function appendModifiers(
  raw: unknown,
  lines: string[],
  path: string[],
  depth: number,
): boolean {
  if (depth > 5) return false;
  const groups = list(raw, 50);
  if (!groups) return false;
  for (const entry of groups) {
    const group = object(entry);
    const groupTitle = text(group?.title, 200);
    if (!group || !groupTitle) return false;
    for (const [key, label] of [['selected_items', '選択'], ['removed_items', '除外']] as const) {
      const modifierItems = list(group[key], 50);
      if (!modifierItems) return false;
      for (const modifierRaw of modifierItems) {
        const modifier = object(modifierRaw);
        const title = text(modifier?.title, 200);
        const quantity = positiveInteger(modifier?.quantity, 999);
        if (!modifier || !title || quantity === null) return false;
        const nextPath = [...path, groupTitle, title];
        lines.push(`${label}: ${nextPath.join(' > ')} ×${quantity}`);
        if (!appendModifiers(modifier.selected_modifier_groups, lines, nextPath, depth + 1)) return false;
      }
    }
  }
  return true;
}

function itemNote(item: JsonObject): string | null | undefined {
  const lines: string[] = [];
  const instructions = optionalText(item.special_instructions, 500);
  if (instructions === undefined) return undefined;
  if (instructions) lines.push(instructions);
  if (!appendModifiers(item.selected_modifier_groups, lines, [], 0)) return undefined;

  const specialRequests = list(item.special_requests, 20);
  if (!specialRequests) return undefined;
  for (const rawRequest of specialRequests) {
    const request = object(rawRequest);
    if (!request) return undefined;
    if (request.allergy === undefined || request.allergy === null) continue;
    const allergy = allergyNote(request.allergy);
    if (allergy === undefined) return undefined;
    if (allergy) lines.push(`アレルギー: ${allergy}`);
  }
  const note = lines.join('\n');
  if (note.length > MAX_ITEM_NOTE_LENGTH) return undefined;
  return note || null;
}

export function parseUberOrder(
  raw: unknown,
  expected: { orderId: string; uberStoreId: string },
  now: number,
): { ok: true; order: WebhookOrder; canceled: boolean; state: UberOrderState } | { ok: false; error: string } {
  if (!Number.isSafeInteger(now)) return { ok: false, error: 'Invalid current time' };
  const source = object(raw);
  const expectedOrderId = text(expected.orderId, 128);
  const expectedStoreId = text(expected.uberStoreId, 128);
  const orderId = text(source?.id, 128);
  const storeId = text(object(source?.store)?.id, 128);
  if (!source || !expectedOrderId || !expectedStoreId || orderId !== expectedOrderId || storeId !== expectedStoreId) {
    return { ok: false, error: 'Uber order identity mismatch' };
  }

  const orderNumber = text(source.display_id, 64);
  const state = text(source.current_state, 32);
  const cart = object(source.cart);
  const payment = object(source.payment);
  const charges = object(payment?.charges);
  const totalAmount = money(charges?.total);
  const cartItems = list(cart?.items, MAX_ITEMS);
  if (!orderNumber || !state || !ORDER_STATES.has(state) || !cart || totalAmount === null || !cartItems) {
    return { ok: false, error: 'Invalid Uber order' };
  }

  const items: WebhookOrder['items'] = [];
  const instanceIds = new Set<string>();
  for (const rawItem of cartItems) {
    const item = object(rawItem);
    const instanceId = text(item?.instance_id, 128);
    const name = text(item?.title, 200);
    const quantity = positiveInteger(item?.quantity, 999);
    const amount = money(object(item?.price)?.unit_price);
    if (!item || !instanceId || instanceIds.has(instanceId) || !name || quantity === null || amount === null) {
      return { ok: false, error: 'Invalid Uber order item' };
    }
    const note = itemNote(item);
    if (note === undefined) return { ok: false, error: 'Invalid Uber order item note' };
    instanceIds.add(instanceId);
    // v2のunit_priceはmodifier込み。modifier金額を足すと二重計上になるため、この整数JPYをそのまま保存する。
    items.push({ name, note, quantity, amount });
  }

  const placedAt = isoEpoch(source.placed_at);
  const wantedAt = isoEpoch(source.estimated_ready_for_pickup_at);
  const customerNote = optionalText(cart.special_instructions, MAX_CUSTOMER_NOTE_LENGTH);
  const pickupMethod = optionalText(source.type, 100);
  if (placedAt === undefined || wantedAt === undefined || customerNote === undefined || pickupMethod === undefined) {
    return { ok: false, error: 'Invalid Uber order details' };
  }

  return {
    ok: true,
    order: {
      externalOrderId: orderId,
      orderNumber,
      // payment.charges.totalは消費者請求額ではなく、公式定義上の店舗受取額として保存する。
      totalAmount,
      pickupMethod,
      wantedAt,
      customerNote,
      receivedAt: placedAt ?? now,
      items,
    },
    canceled: state === 'CANCELED',
    state: state as UberOrderState,
  };
}
