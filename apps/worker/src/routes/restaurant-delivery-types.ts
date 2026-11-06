import type { DeliveryOrderStatus } from '../services/restaurant-delivery.js';
import type { DeliveryService } from '../services/delivery-service-types.js';

// ---------- 行の形 ----------

export interface DeliveryOrderRow {
  id: string;
  account_id: string;
  store_id: string;
  service: DeliveryService;
  external_order_id: string;
  order_number: string;
  status: DeliveryOrderStatus;
  total_amount: number;
  currency: string;
  item_count: number;
  pickup_method: string | null;
  wanted_at: number | null;
  customer_note: string | null;
  urgency: 'urgent' | 'normal' | 'watch';
  urgency_reason: string | null;
  cancel_reason_code: string | null;
  canceled_by: 'store' | 'customer' | 'service' | null;
  received_at: number;
  accepted_at: number | null;
  ready_at: number | null;
  handed_over_at: number | null;
  canceled_at: number | null;
  version: number;
}

export interface DeliveryOrderItemRow {
  id: string;
  order_id: string;
  position: number;
  name: string;
  note: string | null;
  quantity: number;
  amount: number;
}

export interface DeliveryServiceStateRow {
  store_id: string;
  service: DeliveryService;
  connection_status: 'connected' | 'disconnected' | 'error';
  intake_status: 'open' | 'stopped';
  stop_until: number | null;
  stop_requested_at: number | null;
  resumed_at: number | null;
  version: number;
}

export interface DeliveryMenuItemRow {
  id: string;
  store_id: string;
  name: string;
  category: string | null;
  price: number;
  sold_out: number;
  sold_out_at: number | null;
  sort_order: number;
  external_item_ids_json: string | null;
  version: number;
}
