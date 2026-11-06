import { boundedHttpRequest } from '../../lib/external-call/bounded-http.js';
import { UberEatsError, type FetchLike } from '../../services/uber-eats.js';
import {
  UBER_PRODUCTION_HOSTS,
  UBER_SANDBOX_HOSTS,
  type UberHosts,
} from '../../services/uber-eats-hosts.js';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface UberOrderApiOptions {
  hosts: UberHosts;
  accessToken: string;
  fetch: FetchLike;
}

type LocalReasonCode =
  | 'out_of_stock'
  | 'store_busy'
  | 'equipment_trouble'
  | 'customer_request'
  | 'other';

const REJECT_REASONS: Record<LocalReasonCode, { code: string; explanation: string }> = {
  out_of_stock: { code: 'ITEM_AVAILABILITY', explanation: 'Item unavailable' },
  store_busy: { code: 'CAPACITY', explanation: 'Store capacity unavailable' },
  equipment_trouble: { code: 'POS_OFFLINE', explanation: 'Store equipment unavailable' },
  customer_request: { code: 'OTHER', explanation: 'Customer requested cancellation' },
  other: { code: 'OTHER', explanation: 'Other' },
};

const CANCEL_REASONS: Record<LocalReasonCode, string> = {
  out_of_stock: 'OUT_OF_ITEMS',
  store_busy: 'RESTAURANT_TOO_BUSY',
  equipment_trouble: 'OTHER',
  customer_request: 'CUSTOMER_CALLED_TO_CANCEL',
  other: 'OTHER',
};

function localReasonCode(value: string | undefined): LocalReasonCode {
  return value !== undefined && Object.hasOwn(REJECT_REASONS, value)
    ? value as LocalReasonCode
    : 'other';
}

function sameHosts(actual: UberHosts, known: UberHosts): boolean {
  return actual.authorizeUrl === known.authorizeUrl
    && actual.tokenUrl === known.tokenUrl
    && actual.apiBaseUrl === known.apiBaseUrl;
}

function assertOptions(options: UberOrderApiOptions): void {
  if (!sameHosts(options.hosts, UBER_PRODUCTION_HOSTS) && !sameHosts(options.hosts, UBER_SANDBOX_HOSTS)) {
    throw new UberEatsError('invalid_request', null, 'uber_order_host_not_allowed');
  }
  if (!options.accessToken.trim() || options.accessToken.length > 4096) {
    throw new UberEatsError('invalid_request', null, 'uber_order_token_invalid');
  }
}

function orderPath(orderId: string): string {
  const value = orderId.trim();
  if (!value || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new UberEatsError('invalid_request', null, 'uber_order_id_invalid');
  }
  return encodeURIComponent(value);
}

function errorForStatus(status: number): UberEatsError {
  if (status === 401) return new UberEatsError('auth_expired', status);
  if (status === 403) return new UberEatsError('no_permission', status);
  if (status === 404) return new UberEatsError('not_found', status);
  if (status === 429) return new UberEatsError('rate_limited', status);
  if (status >= 500) return new UberEatsError('unavailable', status);
  if (status >= 400) return new UberEatsError('invalid_request', status);
  return new UberEatsError('unknown', status, 'uber_order_unexpected_response');
}

async function request(
  options: UberOrderApiOptions,
  path: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<Response> {
  assertOptions(options);
  const fetchFn = options.fetch;
  let response: Response;
  try {
    response = await boundedHttpRequest(
      `${options.hosts.apiBaseUrl}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          accept: 'application/json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
      },
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        fetch: (input, requestInit) => fetchFn(String(input), requestInit),
      },
    );
  } catch {
    // 通信層やProviderの自由文は上位へ出さず、再送判断に必要な固定分類だけを返す。
    throw new UberEatsError('unavailable', null, 'uber_order_request_failed');
  }
  if (response.status !== expectedStatus) throw errorForStatus(response.status);
  return response;
}

/** 通知内のresource_hrefは使わず、設定済みホストの固定したv2 APIだけを読む。 */
export async function getUberOrder(options: UberOrderApiOptions, orderId: string): Promise<unknown> {
  const response = await request(options, `/v2/eats/order/${orderPath(orderId)}`, { method: 'GET' }, 200);
  try {
    return await response.json();
  } catch {
    throw new UberEatsError('unknown', response.status, 'uber_order_response_invalid');
  }
}

export async function sendUberOrderAction(
  options: UberOrderApiOptions,
  input: { action: 'accept' | 'reject' | 'cancel'; orderId: string; reasonCode?: string },
): Promise<void> {
  const id = orderPath(input.orderId);
  const localReason = localReasonCode(input.reasonCode);

  if (input.action === 'accept') {
    await request(options, `/v1/eats/orders/${id}/accept_pos_order`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Accepted by musubo' }),
    }, 204);
    return;
  }
  if (input.action === 'reject') {
    await request(options, `/v1/eats/orders/${id}/deny_pos_order`, {
      method: 'POST',
      body: JSON.stringify({ reason: REJECT_REASONS[localReason] }),
    }, 204);
    return;
  }
  if (input.action === 'cancel') {
    await request(options, `/v1/eats/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: CANCEL_REASONS[localReason] }),
    }, 200);
    return;
  }
  throw new UberEatsError('invalid_request', null, 'uber_order_action_invalid');
}
