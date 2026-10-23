import { fetchPosData, UberEatsError, type FetchLike, type UberPosData } from '../../services/uber-eats.js';
import type { UberHosts } from '../../services/uber-eats-hosts.js';
import { acquireWebhookLock, releaseWebhookLock } from './webhook-ingestion.js';
import { appliedUberStoreLifecycleState } from './store-lifecycle-ordering.js';
const STORE_EVENT_TYPES = new Set(['store.provisioned', 'store.deprovisioned']);
const LIFECYCLE_LOCK_PREFIX = 'uber-store-lifecycle:';
const LIFECYCLE_STORE_LOCK_PREFIX = 'uber-store-lifecycle-store:';
const PROVISION_REVIEW = 'store_provision_review_required';
const MENU_REFRESH_REVIEW = 'store_menu_refresh_review_required';
const INTERRUPTED: UberStoreLifecycleResult = { status: 503, error: 'Processing interrupted' };
const LIFECYCLE_OWNERSHIP = `s.status = 'active' AND s.line_account_id = u.account_id
  AND o.status <> 'archived'
  AND a.is_active = 1 AND a.archived_at IS NULL AND a.tenant_id = o.tenant_id AND t.status = 'active'
  AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(t.feature_packs) THEN t.feature_packs ELSE '[]' END)
    WHERE value = 'restaurant')
  AND NOT EXISTS (SELECT 1 FROM rt_store_feature_flags f
    WHERE f.store_id = u.store_id AND f.feature = 'delivery' AND f.enabled = 0)`;
const LIFECYCLE_JOINS = `FROM rt_delivery_uber_connections u
  JOIN rt_stores s ON s.id = u.store_id
  JOIN rt_organizations o ON o.id = s.organization_id
  JOIN line_accounts a ON a.id = u.account_id
  JOIN tenants t ON t.id = o.tenant_id`;

export interface UberStoreLifecycleNotification {
  eventType: 'store.provisioned' | 'store.deprovisioned';
  storeId: string;
  clientId: string;
  eventId: string;
  eventTimestampSeconds: number;
  performRefreshMenu: boolean;
}
export type UberStoreLifecycleParseResult =
  | { matched: false }
  | { matched: true; ok: false; error: string }
  | { matched: true; ok: true; notification: UberStoreLifecycleNotification };
interface ConnectionRow {
  store_id: string;
  account_id: string;
  uber_store_id: string;
  status: 'pending_store' | 'connected' | 'expired' | 'no_permission' | 'disconnected';
  connected_at: number | null;
  provisioned_at: number | null;
  disconnected_at: number | null;
  version: number;
}
interface LifecycleEventRow {
  id: string;
  account_id: string;
  event_type: string;
  payload_json: string;
  status: string;
  version: number;
}
interface LifecycleLease {
  eventKey: string;
  storeKey: string;
  owner: string;
  checkedAtMs: number;
}
export interface UberStoreLifecycleResult {
  status: 200 | 400 | 409 | 503;
  error?: string;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value) return null;
  return value;
}

/** Uber's store events have a different envelope from order notifications. */
export function parseUberStoreLifecycleNotification(raw: unknown): UberStoreLifecycleParseResult {
  const body = record(raw);
  if (!body) return { matched: false };
  const eventType = body?.event_type;
  if (typeof eventType !== 'string' || !STORE_EVENT_TYPES.has(eventType)) return { matched: false };
  const meta = record(body.webhook_meta);
  const storeId = boundedText(body.store_id, 255);
  const clientId = boundedText(meta?.client_id, 255);
  const eventId = boundedText(meta?.webhook_msg_uuid, 255);
  const eventTimestampSeconds = meta?.webhook_msg_timestamp;
  const performRefreshMenu = body.perform_refresh_menu ?? false;
  if (!storeId || !clientId || !eventId
    || typeof eventTimestampSeconds !== 'number'
    || !Number.isSafeInteger(eventTimestampSeconds)
    || eventTimestampSeconds <= 0
    || typeof performRefreshMenu !== 'boolean') {
    return { matched: true, ok: false, error: 'Invalid store lifecycle notification' };
  }
  return {
    matched: true,
    ok: true,
    notification: {
      eventType: eventType as UberStoreLifecycleNotification['eventType'],
      storeId,
      clientId,
      eventId,
      eventTimestampSeconds,
      performRefreshMenu,
    },
  };
}

async function exactConnection(db: D1Database, uberStoreId: string): Promise<ConnectionRow | null> {
  const rows = await db.prepare(`SELECT u.store_id, u.account_id, u.uber_store_id,
    u.status, u.connected_at, u.provisioned_at, u.disconnected_at, u.version
    ${LIFECYCLE_JOINS} WHERE u.uber_store_id = ? AND ${LIFECYCLE_OWNERSHIP}
      AND (SELECT COUNT(*) FROM rt_delivery_uber_connections duplicate
        WHERE duplicate.uber_store_id = u.uber_store_id) = 1 LIMIT 2`)
    .bind(uberStoreId).all<ConnectionRow>();
  return rows.results.length === 1 ? rows.results[0]! : null;
}

async function lifecycleEvent(db: D1Database, eventId: string): Promise<LifecycleEventRow | null> {
  return db.prepare(`SELECT id, account_id, event_type, payload_json, status, version
    FROM rt_delivery_events WHERE service = 'ubereats' AND external_event_id = ? LIMIT 1`)
    .bind(eventId).first<LifecycleEventRow>();
}

function sameEvent(row: LifecycleEventRow, connection: ConnectionRow, notice: UberStoreLifecycleNotification): boolean {
  if (row.account_id !== connection.account_id || row.event_type !== notice.eventType) return false;
  try {
    const parsed = parseUberStoreLifecycleNotification(JSON.parse(row.payload_json));
    return parsed.matched && parsed.ok
      && parsed.notification.eventId === notice.eventId
      && parsed.notification.eventType === notice.eventType
      && parsed.notification.storeId === notice.storeId
      && parsed.notification.clientId === notice.clientId
      && parsed.notification.eventTimestampSeconds === notice.eventTimestampSeconds
      && parsed.notification.performRefreshMenu === notice.performRefreshMenu;
  } catch {
    return false;
  }
}

async function openLifecycleEvent(input: {
  db: D1Database;
  connection: ConnectionRow;
  notice: UberStoreLifecycleNotification;
  rawBody: string;
  nowSeconds: number;
  lease: LifecycleLease;
}): Promise<LifecycleEventRow | null> {
  await input.db.prepare(`INSERT OR IGNORE INTO rt_delivery_events
    (id, account_id, service, external_event_id, event_type, external_order_id,
      status, payload_json, attempts, received_at, version)
    SELECT ?, ?, 'ubereats', ?, ?, NULL, 'received', ?, 0, ?, 1
    WHERE EXISTS (SELECT 1 ${LIFECYCLE_JOINS}
      WHERE u.store_id = ? AND u.account_id = ? AND u.uber_store_id = ? AND u.version = ?
        AND ${LIFECYCLE_OWNERSHIP}
        AND (SELECT COUNT(*) FROM rt_delivery_uber_connections duplicate
          WHERE duplicate.uber_store_id = u.uber_store_id) = 1
        AND (SELECT COUNT(*) FROM rt_resource_locks active_lock
          WHERE active_lock.resource_key IN (?, ?) AND active_lock.owner_token = ?
            AND julianday(active_lock.expires_at) > julianday(?)) = 2)`)
    .bind(crypto.randomUUID(), input.connection.account_id, input.notice.eventId, input.notice.eventType,
      input.rawBody, input.nowSeconds, input.connection.store_id, input.connection.account_id,
      input.connection.uber_store_id, input.connection.version, input.lease.eventKey, input.lease.storeKey,
      input.lease.owner, new Date(input.lease.checkedAtMs).toISOString()).run();
  return lifecycleEvent(input.db, input.notice.eventId);
}

async function finishWithoutConnection(input: {
  db: D1Database;
  event: LifecycleEventRow;
  status: 'ignored' | 'failed' | 'retryable_failed';
  code: string;
  nowSeconds: number;
  lease: LifecycleLease;
}): Promise<boolean> {
  const result = await input.db.prepare(`UPDATE rt_delivery_events
    SET status = ?, error_code = ?, processed_at = ?, attempts = attempts + 1, version = version + 1
    WHERE id = ? AND version = ? AND status IN ('received', 'retryable_failed')
      AND (SELECT COUNT(*) FROM rt_resource_locks active_lock
        WHERE active_lock.resource_key IN (?, ?) AND active_lock.owner_token = ?
          AND julianday(active_lock.expires_at) > julianday(?)) = 2`)
    .bind(input.status, input.code, input.nowSeconds, input.event.id, input.event.version,
      input.lease.eventKey, input.lease.storeKey, input.lease.owner,
      new Date(input.lease.checkedAtMs).toISOString()).run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function finishWithConnection(input: {
  db: D1Database;
  connection: ConnectionRow;
  event: LifecycleEventRow;
  notice: UberStoreLifecycleNotification;
  nowMs: number;
  connectionSql: string;
  connectionBinds: unknown[];
  expectedStatus: ConnectionRow['status'];
  eventStatus: 'processed' | 'failed';
  eventCode: string | null;
  /** A same-second deprovision may be accepted only after live reconciliation. */
  timestampFenceMs?: number;
  lease: LifecycleLease;
}): Promise<boolean> {
  const eventMs = input.notice.eventTimestampSeconds * 1000;
  const statements = [
    input.db.prepare(`${input.connectionSql}
      WHERE store_id = ? AND account_id = ? AND uber_store_id = ? AND version = ?
        AND ? >= MAX(COALESCE(connected_at, 0), COALESCE(provisioned_at, 0), COALESCE(disconnected_at, 0))
        AND EXISTS (SELECT 1 FROM rt_delivery_events lifecycle_event
          WHERE lifecycle_event.id = ? AND lifecycle_event.version = ?
            AND lifecycle_event.status IN ('received', 'retryable_failed'))
        AND (SELECT COUNT(*) FROM rt_resource_locks lifecycle_lock
          WHERE lifecycle_lock.resource_key IN (?, ?) AND lifecycle_lock.owner_token = ?
            AND julianday(lifecycle_lock.expires_at) > julianday(?)) = 2
        AND (SELECT COUNT(*) FROM rt_delivery_uber_connections duplicate
          WHERE duplicate.uber_store_id = rt_delivery_uber_connections.uber_store_id) = 1
        AND EXISTS (SELECT 1 FROM rt_stores s
          JOIN rt_organizations o ON o.id = s.organization_id
          JOIN line_accounts a ON a.id = rt_delivery_uber_connections.account_id
          JOIN tenants t ON t.id = o.tenant_id
          WHERE s.id = rt_delivery_uber_connections.store_id
            AND s.status = 'active' AND s.line_account_id = rt_delivery_uber_connections.account_id
            AND o.status <> 'archived'
            AND a.is_active = 1 AND a.archived_at IS NULL AND a.tenant_id = o.tenant_id AND t.status = 'active'
            AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(t.feature_packs) THEN t.feature_packs ELSE '[]' END)
              WHERE value = 'restaurant')
            AND NOT EXISTS (SELECT 1 FROM rt_store_feature_flags f
              WHERE f.store_id = rt_delivery_uber_connections.store_id AND f.feature = 'delivery' AND f.enabled = 0))`)
      .bind(...input.connectionBinds, input.connection.store_id, input.connection.account_id,
        input.connection.uber_store_id, input.connection.version, input.timestampFenceMs ?? eventMs,
        input.event.id, input.event.version, input.lease.eventKey, input.lease.storeKey, input.lease.owner,
        new Date(input.lease.checkedAtMs).toISOString()),
    input.db.prepare(`UPDATE rt_delivery_events
      SET status = ?, error_code = ?, processed_at = ?, attempts = attempts + 1, version = version + 1
      WHERE id = ? AND version = ? AND status IN ('received', 'retryable_failed')
        AND changes() = 1
        AND EXISTS (SELECT 1 FROM rt_delivery_uber_connections
          WHERE store_id = ? AND account_id = ? AND uber_store_id = ?
            AND version = ? AND status = ?)
        AND (SELECT COUNT(*) FROM rt_resource_locks lifecycle_lock
          WHERE lifecycle_lock.resource_key IN (?, ?) AND lifecycle_lock.owner_token = ?
            AND julianday(lifecycle_lock.expires_at) > julianday(?)) = 2`)
      .bind(input.eventStatus, input.eventCode, Math.floor(input.nowMs / 1000), input.event.id,
        input.event.version, input.connection.store_id, input.connection.account_id,
        input.connection.uber_store_id, input.connection.version + 1, input.expectedStatus,
        input.lease.eventKey, input.lease.storeKey, input.lease.owner,
        new Date(input.lease.checkedAtMs).toISOString()),
  ];
  const results = await input.db.batch(statements);
  return Number(results[1]?.meta.changes ?? 0) === 1;
}

async function deferProvision(input: {
  db: D1Database;
  connection: ConnectionRow;
  event: LifecycleEventRow;
  notice: UberStoreLifecycleNotification;
  nowMs: number;
  status?: ConnectionRow['status'];
  code?: string;
  timestampFenceMs?: number;
  lease: LifecycleLease;
}): Promise<boolean> {
  return finishWithConnection({
    ...input,
    connectionSql: `UPDATE rt_delivery_uber_connections SET status = ?, last_error = ?,
      version = version + 1, updated_at = ?`,
    connectionBinds: [input.status ?? 'pending_store', input.code ?? PROVISION_REVIEW, input.nowMs],
    expectedStatus: input.status ?? 'pending_store',
    eventStatus: 'failed',
    eventCode: input.code ?? PROVISION_REVIEW,
  });
}

async function currentPos(input: {
  getAccessToken: () => Promise<string>;
  fetcher: FetchLike;
  hosts: UberHosts;
  storeId: string;
}): Promise<UberPosData> {
  const accessToken = await input.getAccessToken();
  return fetchPosData({ fetch: input.fetcher, accessToken, hosts: input.hosts }, input.storeId);
}

function posMatches(pos: UberPosData, connection: ConnectionRow, expectedClientId: string): boolean {
  return pos.integrationEnabled
    && pos.integratorStoreId === connection.store_id
    && !pos.isOrderManagerPending
    && pos.orderManagerClientId === expectedClientId;
}

function isConfigurationError(error: unknown): boolean {
  return error instanceof UberEatsError
    && (error.kind === 'no_permission' || error.kind === 'not_found' || error.kind === 'invalid_request');
}

async function retainRetry(input: {
  db: D1Database;
  event: LifecycleEventRow;
  nowSeconds: number;
  lease: LifecycleLease;
}): Promise<UberStoreLifecycleResult> {
  await finishWithoutConnection({
    ...input,
    status: 'retryable_failed',
    code: 'store_provision_reconcile_retryable',
  });
  return { status: 503, error: 'Store reconciliation failed' };
}

/**
 * Process only after the route has verified the raw-body HMAC. Unknown stores are acknowledged
 * without creating a local mapping; a store event cannot grant access or tenant ownership.
 */
export async function processUberStoreLifecycleNotification(input: {
  db: D1Database;
  notification: UberStoreLifecycleNotification;
  rawBody: string;
  expectedClientId: string;
  hosts: UberHosts;
  fetcher: FetchLike;
  getAccessToken: () => Promise<string>;
  nowMs?: number;
}): Promise<UberStoreLifecycleResult> {
  const { notification: notice } = input;
  if (notice.clientId !== input.expectedClientId) return { status: 400, error: 'Store lifecycle client mismatch' };
  const nowMs = input.nowMs ?? Date.now();
  const wallClockStartedAtMs = Date.now();
  const elapsedNowMs = () => nowMs + Math.max(0, Date.now() - wallClockStartedAtMs);
  const nowSeconds = Math.floor(nowMs / 1000);
  const owner = crypto.randomUUID();
  const eventKey = `${LIFECYCLE_LOCK_PREFIX}${notice.eventId}`;
  const storeKey = `${LIFECYCLE_STORE_LOCK_PREFIX}${notice.storeId}`;
  const currentLease = (): LifecycleLease => ({ eventKey, storeKey, owner, checkedAtMs: elapsedNowMs() });
  if (!await acquireWebhookLock(input.db, storeKey, owner, nowSeconds)) {
    return { status: 503, error: 'Processing is busy' };
  }
  let hasEventLock = false;
  try {
    hasEventLock = await acquireWebhookLock(input.db, eventKey, owner, nowSeconds);
    if (!hasEventLock) return { status: 503, error: 'Processing is busy' };
    const connection = await exactConnection(input.db, notice.storeId);
    // No tenant can safely own a receipt until an existing exact mapping identifies it.
    if (!connection) return { status: 200 };
    let event = await lifecycleEvent(input.db, notice.eventId);
    if (event && !sameEvent(event, connection, notice)) return { status: 409, error: 'Event identity conflict' };
    if (event && ['processed', 'ignored', 'failed'].includes(event.status)) return { status: 200 };
    if (!event) {
      event = await openLifecycleEvent({
        db: input.db, connection, notice, rawBody: input.rawBody, nowSeconds, lease: currentLease(),
      });
      if (!event || !sameEvent(event, connection, notice)) return { status: 503, error: 'Connection changed' };
    }

    const eventMs = notice.eventTimestampSeconds * 1000;
    let lifecycleFenceMs = eventMs;
    let verifiedPos: UberPosData | null = null;
    const appliedState = await appliedUberStoreLifecycleState(input.db, connection.account_id, notice.storeId);
    const orderingMs = Math.max(
      connection.connected_at ?? 0,
      connection.provisioned_at ?? 0,
      connection.disconnected_at ?? 0,
      appliedState.timestampMs,
    );
    const preserveReview = notice.eventType === 'store.provisioned'
      && eventMs === appliedState.timestampMs && appliedState.reviewRequired;
    if (eventMs <= orderingMs) {
      const sameSecond = Math.floor(orderingMs / 1000) === notice.eventTimestampSeconds;
      if (!sameSecond) {
        if (!await finishWithoutConnection({ db: input.db, event, status: 'ignored',
          code: 'store_lifecycle_stale', nowSeconds, lease: currentLease() })) return INTERRUPTED;
        return { status: 200 };
      }
      // Provider timestamps are only second-granular. Reconcile the ambiguous same-second case
      // against current provider state before changing a newer local lifecycle transition.
      try {
        const pos = await currentPos({ ...input, storeId: notice.storeId });
        const matches = posMatches(pos, connection, input.expectedClientId);
        if (preserveReview) {
          if (!await finishWithoutConnection({ db: input.db, event, status: 'ignored',
            code: 'store_lifecycle_stale', nowSeconds, lease: currentLease() })) return INTERRUPTED;
          return { status: 200 };
        }
        if (notice.eventType === 'store.deprovisioned' && matches) {
          if (!await finishWithoutConnection({ db: input.db, event, status: 'ignored',
            code: 'store_lifecycle_stale', nowSeconds, lease: currentLease() })) return INTERRUPTED;
          return { status: 200 };
        }
        if (notice.eventType === 'store.provisioned') {
          if (!matches && connection.status === 'disconnected') {
            if (!await finishWithoutConnection({ db: input.db, event, status: 'ignored',
              code: 'store_lifecycle_stale', nowSeconds, lease: currentLease() })) return INTERRUPTED;
            return { status: 200 };
          }
          if (!matches) {
            if (!await deferProvision({ db: input.db, connection, event, notice, nowMs,
              timestampFenceMs: orderingMs, lease: currentLease() })) {
              return INTERRUPTED;
            }
            return { status: 200 };
          }
          verifiedPos = pos;
        }
      } catch (error) {
        const confirmsNoAccess = error instanceof UberEatsError
          && (error.kind === 'no_permission' || error.kind === 'not_found');
        if (preserveReview && isConfigurationError(error)) {
          if (!await finishWithoutConnection({ db: input.db, event, status: 'ignored',
            code: 'store_lifecycle_stale', nowSeconds, lease: currentLease() })) return INTERRUPTED;
          return { status: 200 };
        }
        if (notice.eventType === 'store.provisioned' && confirmsNoAccess && connection.status === 'disconnected') {
          if (!await finishWithoutConnection({ db: input.db, event, status: 'ignored',
            code: 'store_lifecycle_stale', nowSeconds, lease: currentLease() })) return INTERRUPTED;
          return { status: 200 };
        }
        if (notice.eventType === 'store.provisioned' && confirmsNoAccess) {
          if (!await deferProvision({ db: input.db, connection, event, notice, nowMs,
            timestampFenceMs: orderingMs, lease: currentLease() })) {
            return INTERRUPTED;
          }
          return { status: 200 };
        }
        if (!confirmsNoAccess) {
          return retainRetry({ db: input.db, event, nowSeconds, lease: currentLease() });
        }
      }
      lifecycleFenceMs = orderingMs;
    }

    if (notice.eventType === 'store.deprovisioned') {
      const finished = await finishWithConnection({
        db: input.db,
        connection,
        event,
        notice,
        nowMs,
        connectionSql: `UPDATE rt_delivery_uber_connections SET status = 'disconnected',
          access_token_enc = NULL, access_token_expires_at = NULL, granted_scope = NULL,
          provisioned_at = NULL, disconnected_at = ?, last_error = NULL,
          version = version + 1, updated_at = ?`,
        connectionBinds: [eventMs, nowMs],
        expectedStatus: 'disconnected',
        eventStatus: 'processed',
        eventCode: null,
        timestampFenceMs: lifecycleFenceMs,
        lease: currentLease(),
      });
      return finished ? { status: 200 } : INTERRUPTED;
    }

    try {
      const pos = verifiedPos ?? await currentPos({ ...input, storeId: notice.storeId });
      if (!posMatches(pos, connection, input.expectedClientId)) {
        if (!await deferProvision({ db: input.db, connection, event, notice, nowMs,
          timestampFenceMs: lifecycleFenceMs, lease: currentLease() })) {
          return INTERRUPTED;
        }
        return { status: 200 };
      }
    } catch (error) {
      if (!isConfigurationError(error)) return retainRetry({ db: input.db, event, nowSeconds, lease: currentLease() });
      if (!await deferProvision({ db: input.db, connection, event, notice, nowMs, lease: currentLease() })) {
        return INTERRUPTED;
      }
      return { status: 200 };
    }

    if (notice.performRefreshMenu) {
      if (!await deferProvision({
        db: input.db, connection, event, notice, nowMs,
        code: MENU_REFRESH_REVIEW, timestampFenceMs: lifecycleFenceMs, lease: currentLease(),
      })) {
        return INTERRUPTED;
      }
      return { status: 200 };
    }

    const finished = await finishWithConnection({
      db: input.db,
      connection,
      event,
      notice,
      nowMs,
      connectionSql: `UPDATE rt_delivery_uber_connections SET status = 'connected',
        connected_at = COALESCE(connected_at, ?), provisioned_at = ?, disconnected_at = NULL,
        last_error = NULL, version = version + 1, updated_at = ?`,
      connectionBinds: [eventMs, eventMs, nowMs],
      expectedStatus: 'connected',
      eventStatus: 'processed',
      eventCode: null,
      timestampFenceMs: lifecycleFenceMs,
      lease: currentLease(),
    });
    return finished ? { status: 200 } : INTERRUPTED;
  } finally {
    try {
      if (hasEventLock) await releaseWebhookLock(input.db, eventKey, owner);
      await releaseWebhookLock(input.db, storeKey, owner);
    } catch { /* The short lease recovers on its own. */ }
  }
}
