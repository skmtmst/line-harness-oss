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
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../index.js';
import { requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import type { AuditAction } from '../lib/audit-log.js';
import { restaurantTestEnabled } from '../lib/environment-features.js';
import { computeHmacSha256Hex, safeEqualHex } from '../lib/hmac.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { dbFor } from '../services/db-router.js';
import { tenantHasFeaturePack } from '../services/tenant-features.js';
import { accountId, fail, staffTenantId, storeFor } from './restaurant-google.js';
import type { StoreContext } from './restaurant-google.js';
import {
  DELIVERY_SERVICES,
  DELIVERY_SERVICE_LABELS,
  canTransitionOrder,
  deliveryWebhookSecret,
  dispatchToDeliveryService,
  isDeliveryService,
  isIntakeStopPreset,
  intakeStopUntil,
  judgeUrgency,
  nowSec,
  summarizeOrderItems,
  tokyoDateText,
  tokyoDayRange,
} from '../services/restaurant-delivery.js';
import type {
  DeliveryAction,
  DeliveryDispatchResult,
  DeliveryOrderStatus,
  DeliveryService,
} from '../services/restaurant-delivery.js';

export const restaurantDelivery = new Hono<Env>();

/** 署名で守る外部受信の入口。管理画面の認証・統括ゲートは通さない。 */
const WEBHOOK_PREFIX = '/api/restaurant-test/delivery/webhooks/';

/** 取り消せない操作の確認合言葉（画面の確認手順を経た印）。 */
const CANCEL_CONFIRM_TOKEN = 'delivery-order-cancel';
const INTAKE_STOP_CONFIRM_TOKEN = 'delivery-intake-stop';

/** CSVの返す上限。超えた分は打ち切りヘッダで知らせる。 */
const CSV_MAX_ROWS = 5000;

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

// ---------- 画面へ返す共通の形 ----------

/**
 * CSVの1マス。`=`『+』『-』『@』始まりは表計算の式として実行されるため、
 * 先頭に `'` を付けて式にしない（automations.ts と同じ守り方）。
 */
function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * 画面に出す状態の名前。英語の符号は出さない。
 *
 * 承認済みデザインの状態は「新着・調理中・受け渡し済み・キャンセル」の4つだけ。
 * 店の操作は「準備完了」で終わり、そのあと受け渡されたかどうかは各サービスからの
 * 通知で内部的に分かれるだけなので、`ready` と `handed_over` は同じ名前で見せる。
 */
const ORDER_STATUS_LABELS: Record<DeliveryOrderStatus, string> = {
  new: '新着',
  cooking: '調理中',
  ready: '受け渡し済み',
  handed_over: '受け渡し済み',
  canceled: 'キャンセル',
  rejected: '拒否',
};

/** 日時はエポック秒で持ち、画面向けにISO文字列へ直す。 */
function isoOrNull(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  return new Date(seconds * 1000).toISOString();
}

// ---------- 入口の検査（restaurant-google.ts と同じ3点検査） ----------

export const deliveryAccessGuard: MiddlewareHandler<Env> = async (c, next) => {
  // 署名検証で守る外部受信は管理画面の認証を通さない。
  if (c.req.path.startsWith(WEBHOOK_PREFIX)) return next();
  if (!restaurantTestEnabled(c.env)) return fail(c, 404, 'Not found');
  // 統括ゲート。パック無しは環境無効と同じ404。
  if (!(await tenantHasFeaturePack(dbFor(c.env), staffTenantId(c), 'restaurant'))) {
    return fail(c, 404, 'Not found');
  }
  const requestedTenant = c.req.query('tenant_id');
  if (requestedTenant && requestedTenant !== staffTenantId(c)) {
    return fail(c, 403, 'この統括を操作する権限がありません');
  }
  const selectedAccount = accountId(c);
  if (!selectedAccount) return next();
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  if (!scope.ids.includes(selectedAccount)) {
    return fail(c, 403, 'このLINEアカウントを操作する権限がありません');
  }
  return next();
};
restaurantDelivery.use('/api/restaurant-test/delivery/*', deliveryAccessGuard);

/** 選んだLINEアカウントに紐付く店舗。無ければ404の文を返す。 */
async function deliveryStore(c: Context<Env>): Promise<StoreContext | null> {
  return storeFor(c);
}

/** 店舗×サービスの状態を、無ければ既定値で埋めて全サービス分そろえる。 */
async function serviceStates(
  c: Context<Env>,
  store: StoreContext,
): Promise<DeliveryServiceStateRow[]> {
  const rows = await dbFor(c.env, store.id)
    .prepare(
      `SELECT store_id, service, connection_status, intake_status, stop_until,
              stop_requested_at, resumed_at, version
         FROM rt_delivery_service_states WHERE store_id = ?`,
    )
    .bind(store.id)
    .all<DeliveryServiceStateRow>();
  const byService = new Map((rows.results ?? []).map((row) => [row.service, row]));
  return DELIVERY_SERVICES.map(
    (service) =>
      byService.get(service) ?? {
        store_id: store.id,
        service,
        connection_status: 'disconnected' as const,
        intake_status: 'open' as const,
        stop_until: null,
        stop_requested_at: null,
        resumed_at: null,
        version: 1,
      },
  );
}

/** 同じ店舗で調理中の件数。急ぎ度の判定に渡す。 */
async function cookingCountFor(c: Context<Env>, store: StoreContext): Promise<number> {
  const row = await dbFor(c.env, store.id)
    .prepare(
      `SELECT COUNT(*) AS count FROM rt_delivery_orders
        WHERE store_id = ? AND status IN ('new','cooking')`,
    )
    .bind(store.id)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * 送信台帳へ1件起こす。送る前に必ず呼び、結果で閉じる。
 * 送信が失敗した時は注文・商品・受付の状態を変えない。
 */
async function openDispatch(
  c: Context<Env>,
  store: StoreContext,
  input: {
    service: DeliveryService;
    action: DeliveryAction;
    targetKind: 'order' | 'menu_item' | 'service';
    targetId: string | null;
    now: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await dbFor(c.env, store.id)
    .prepare(
      `INSERT INTO rt_delivery_dispatches
         (id, account_id, store_id, service, action, target_kind, target_id,
          status, attempts, requested_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    )
    .bind(
      id,
      store.lineAccountId,
      store.id,
      input.service,
      input.action,
      input.targetKind,
      input.targetId,
      input.now,
      input.now,
      input.now,
    )
    .run();
  return id;
}

/** 送信結果で台帳を閉じる。失敗は分類済みの符号だけを残す。 */
async function closeDispatch(
  c: Context<Env>,
  store: StoreContext,
  dispatchId: string,
  result: DeliveryDispatchResult,
  now: number,
): Promise<void> {
  const status = result.ok
    ? 'succeeded'
    : result.error.retryable && result.nextAttemptAt !== null
      ? 'retryable_failed'
      : result.nextAttemptAt === null && result.error.retryable
        ? 'exhausted'
        : 'failed';
  await dbFor(c.env, store.id)
    .prepare(
      `UPDATE rt_delivery_dispatches
          SET status = ?, error_code = ?, attempts = attempts + 1, next_attempt_at = ?,
              completed_at = ?, version = version + 1, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      status,
      result.ok ? null : result.error.code,
      result.ok ? null : result.nextAttemptAt,
      now,
      now,
      dispatchId,
    )
    .run();
}

/**
 * 「台帳へ起こす → 送る → 台帳を閉じる」をひとまとめにする。
 * 呼び出し側は ok:true のときだけ状態を進める。
 */
async function sendWithLedger(
  c: Context<Env>,
  store: StoreContext,
  input: {
    service: DeliveryService;
    action: DeliveryAction;
    targetKind: 'order' | 'menu_item' | 'service';
    targetId: string | null;
    externalId?: string | null;
    body?: Record<string, unknown>;
    now: number;
  },
): Promise<DeliveryDispatchResult> {
  const dispatchId = await openDispatch(c, store, input);
  const result = await dispatchToDeliveryService(
    c.env,
    {
      service: input.service,
      action: input.action,
      externalId: input.externalId ?? null,
      body: input.body,
    },
    { completedAttempts: 0, now: new Date(input.now * 1000) },
  );
  await closeDispatch(c, store, dispatchId, result, input.now);
  return result;
}

/** 送信に失敗した時の返し方。画面には分類済みの短い文だけを出す。 */
function dispatchFailure(c: Context<Env>, result: Extract<DeliveryDispatchResult, { ok: false }>) {
  const status = result.error.retryable ? 503 : 502;
  return fail(c, status, result.error.message, {
    code: result.error.code,
    retryable: result.error.retryable,
  });
}

/** 注文に紐付く品目をまとめて引く。要約文と詳細の両方で使う。 */
async function itemsForOrders(
  c: Context<Env>,
  store: StoreContext,
  orderIds: string[],
): Promise<Map<string, DeliveryOrderItemRow[]>> {
  const byOrder = new Map<string, DeliveryOrderItemRow[]>();
  if (orderIds.length === 0) return byOrder;
  const placeholders = orderIds.map(() => '?').join(',');
  const rows = await dbFor(c.env, store.id)
    .prepare(
      `SELECT id, order_id, position, name, note, quantity, amount
         FROM rt_delivery_order_items
        WHERE order_id IN (${placeholders})
        ORDER BY order_id, position`,
    )
    .bind(...orderIds)
    .all<DeliveryOrderItemRow>();
  for (const row of rows.results ?? []) {
    const list = byOrder.get(row.order_id);
    if (list) list.push(row);
    else byOrder.set(row.order_id, [row]);
  }
  return byOrder;
}

// ---------- D-1 `kDQHr` 受注一覧 ----------

/**
 * 承認済みデザイン D-1 のタブは「新着」「調理中」「受け渡し済み」「すべて」の4つ。
 *
 * 「新着」「調理中」はまだ手が離れていない注文なので、日付で切らずに全部出す。
 * 日をまたいだ注文を画面から消すと、店が気づけないまま残ってしまう。
 * 「受け渡し済み」「すべて」は本日（日本時間）を数える。過去の分はD-4で見る。
 */
type OrderTab = 'all' | 'new' | 'cooking' | 'handed_over';

function orderTabFrom(value: string | undefined): OrderTab {
  if (value === 'new' || value === 'cooking' || value === 'handed_over' || value === 'all') {
    return value;
  }
  return 'all';
}

/** 1日ぶんの件数と金額をサービス・状態ごとに数えるSQL。本日と前日で同じものを使う。 */
const DAY_SUMMARY_SQL = `SELECT service,
          status,
          COUNT(*) AS count,
          COALESCE(SUM(total_amount), 0) AS amount
     FROM rt_delivery_orders
    WHERE store_id = ? AND received_at >= ? AND received_at < ?
    GROUP BY service, status`;

/**
 * 平均準備時間。受け付けてから準備完了（または受け渡し）までの秒数。
 * どちらかの時刻が無い注文は平均に入れない（0分として混ぜると実態より短く出る）。
 */
const PREP_SECONDS_SQL = `SELECT AVG(COALESCE(ready_at, handed_over_at) - accepted_at) AS seconds
     FROM rt_delivery_orders
    WHERE store_id = ? AND received_at >= ? AND received_at < ?
      AND accepted_at IS NOT NULL
      AND COALESCE(ready_at, handed_over_at) IS NOT NULL`;

interface DaySummaryRow {
  service: DeliveryService;
  status: DeliveryOrderStatus;
  count: number;
  amount: number;
}

interface DaySummary {
  /** 売上に数える注文の件数（キャンセル・拒否を除く）。 */
  count: number;
  amount: number;
  handedOverCount: number;
  /** キャンセル・拒否の件数。件数・売上には混ぜず、「すべて」の数だけに足す。 */
  canceledCount: number;
  byService: Map<DeliveryService, { count: number; amount: number }>;
}

function summarizeDay(rows: DaySummaryRow[] | undefined): DaySummary {
  const summary: DaySummary = {
    count: 0,
    amount: 0,
    handedOverCount: 0,
    canceledCount: 0,
    byService: new Map(),
  };
  for (const row of rows ?? []) {
    if (row.status === 'canceled' || row.status === 'rejected') {
      summary.canceledCount += row.count;
      continue;
    }
    summary.count += row.count;
    summary.amount += row.amount;
    if (row.status === 'ready' || row.status === 'handed_over') {
      summary.handedOverCount += row.count;
    }
    const current = summary.byService.get(row.service) ?? { count: 0, amount: 0 };
    current.count += row.count;
    current.amount += row.amount;
    summary.byService.set(row.service, current);
  }
  return summary;
}

/** 平均の秒を分にする。平均が取れないときは数を作らず null（画面は「—」にする）。 */
function averageMinutes(seconds: number | null | undefined): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return Math.max(0, Math.round(seconds / 60));
}

/** 前日比の割合。前日が0件のときは割合にならないので null を返す。 */
function percentDelta(today: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((today - previous) / previous) * 100);
}

restaurantDelivery.get(
  '/api/restaurant-test/delivery/orders',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const store = await deliveryStore(c);
    if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
    const now = nowSec();
    const today = tokyoDayRange(null, now);
    const db = dbFor(c.env, store.id);
    const tab = orderTabFrom(c.req.query('tab'));
    const serviceFilter = c.req.query('service');
    if (serviceFilter && !isDeliveryService(serviceFilter)) {
      return fail(c, 400, '対象のサービスが選べていません');
    }

    // 前日と比べるために、同じ数え方で前日ぶんも取る（D-1のKPIの札）。
    const yesterday = tokyoDayRange(tokyoDateText(now - 24 * 60 * 60), now);

    const [
      states,
      cookingCount,
      openCountRows,
      todayRows,
      yesterdayRows,
      todayPrep,
      yesterdayPrep,
      openRows,
    ] = await Promise.all([
      serviceStates(c, store),
      cookingCountFor(c, store),
      // まだ手が離れていない注文の数。日付では切らない。
      db
        .prepare(
          `SELECT status, COUNT(*) AS count FROM rt_delivery_orders
            WHERE store_id = ? AND status IN ('new','cooking')
            GROUP BY status`,
        )
        .bind(store.id)
        .all<{ status: DeliveryOrderStatus; count: number }>(),
      db.prepare(DAY_SUMMARY_SQL).bind(store.id, today.from, today.to).all<DaySummaryRow>(),
      db
        .prepare(DAY_SUMMARY_SQL)
        .bind(store.id, yesterday.from, yesterday.to)
        .all<DaySummaryRow>(),
      db
        .prepare(PREP_SECONDS_SQL)
        .bind(store.id, today.from, today.to)
        .first<{ seconds: number | null }>(),
      db
        .prepare(PREP_SECONDS_SQL)
        .bind(store.id, yesterday.from, yesterday.to)
        .first<{ seconds: number | null }>(),
      // 急ぎ対応の件数を数えるための軽い読み取り。判定はWorker側だけで行う。
      db
        .prepare(
          `SELECT id, status, received_at, wanted_at, item_count FROM rt_delivery_orders
            WHERE store_id = ? AND status IN ('new','cooking')`,
        )
        .bind(store.id)
        .all<
          Pick<DeliveryOrderRow, 'id' | 'status' | 'received_at' | 'wanted_at' | 'item_count'>
        >(),
    ]);

    const todaySummary = summarizeDay(todayRows.results);
    const yesterdaySummary = summarizeDay(yesterdayRows.results);

    const tabCounts = { all: 0, new: 0, cooking: 0, handed_over: 0 };
    for (const row of openCountRows.results ?? []) {
      if (row.status === 'new') tabCounts.new = row.count;
      if (row.status === 'cooking') tabCounts.cooking = row.count;
    }
    tabCounts.handed_over = todaySummary.handedOverCount;
    // 「すべて」は本日の注文と、まだ手が離れていない注文の合計。
    tabCounts.all =
      tabCounts.new + tabCounts.cooking + tabCounts.handed_over + todaySummary.canceledCount;

    const urgentCount = (openRows.results ?? []).filter(
      (row) =>
        judgeUrgency({
          status: row.status,
          receivedAt: row.received_at,
          wantedAt: row.wanted_at,
          itemCount: row.item_count,
          cookingCount,
          now,
        }).urgency === 'urgent',
    ).length;

    const todayPrepMinutes = averageMinutes(todayPrep?.seconds);
    const yesterdayPrepMinutes = averageMinutes(yesterdayPrep?.seconds);

    const bindings: unknown[] = [store.id];
    let tabClause: string;
    if (tab === 'new') {
      tabClause = "status = 'new'";
    } else if (tab === 'cooking') {
      tabClause = "status = 'cooking'";
    } else if (tab === 'handed_over') {
      tabClause = "status IN ('ready','handed_over') AND received_at >= ? AND received_at < ?";
      bindings.push(today.from, today.to);
    } else {
      tabClause = "(status IN ('new','cooking') OR (received_at >= ? AND received_at < ?))";
      bindings.push(today.from, today.to);
    }
    let serviceClause = '';
    if (serviceFilter) {
      serviceClause = ' AND service = ?';
      bindings.push(serviceFilter);
    }
    // 承認済みデザインの並びは新しい注文が上。急ぎは「急ぎ度」の列で見せる。
    const orderRows = await db
      .prepare(
        `SELECT * FROM rt_delivery_orders
          WHERE store_id = ? AND (${tabClause})${serviceClause}
          ORDER BY received_at DESC
          LIMIT 200`,
      )
      .bind(...bindings)
      .all<DeliveryOrderRow>();
    const orders = orderRows.results ?? [];
    const items = await itemsForOrders(
      c,
      store,
      orders.map((row) => row.id),
    );

    return c.json({
      success: true,
      store: { id: store.id, name: store.name },
      // D-1上段のサービスカード。接続と受付の状況、本日の件数を出す。
      services: states.map((state) => ({
        service: state.service,
        label: DELIVERY_SERVICE_LABELS[state.service],
        connectionStatus: state.connection_status,
        intakeStatus: state.intake_status,
        stopUntil: isoOrNull(state.stop_until),
        todayCount: todaySummary.byService.get(state.service)?.count ?? 0,
        todayAmount: todaySummary.byService.get(state.service)?.amount ?? 0,
      })),
      /**
       * D-1のKPI4枚。「本日の注文」「本日の売上」「急ぎ対応」「平均準備時間」。
       * 前日と比べられないとき（前日が0件、平均が取れない）は数を作らず null を返し、
       * 画面側で「—」にする。
       */
      kpis: {
        todayCount: todaySummary.count,
        todayCountDelta: todaySummary.count - yesterdaySummary.count,
        handedOverCount: todaySummary.handedOverCount,
        todaySales: todaySummary.amount,
        todaySalesDeltaPercent: percentDelta(todaySummary.amount, yesterdaySummary.amount),
        averageAmount:
          todaySummary.count > 0 ? Math.round(todaySummary.amount / todaySummary.count) : null,
        urgentCount,
        averagePrepMinutes: todayPrepMinutes,
        averagePrepMinutesDelta:
          todayPrepMinutes === null || yesterdayPrepMinutes === null
            ? null
            : todayPrepMinutes - yesterdayPrepMinutes,
      },
      tab,
      tabCounts,
      orders: orders.map((row) => {
        const urgency = judgeUrgency({
          status: row.status,
          receivedAt: row.received_at,
          wantedAt: row.wanted_at,
          itemCount: row.item_count,
          cookingCount,
          now,
        });
        return {
          id: row.id,
          service: row.service,
          serviceLabel: DELIVERY_SERVICE_LABELS[row.service],
          orderNumber: row.order_number,
          status: row.status,
          statusLabel: ORDER_STATUS_LABELS[row.status],
          totalAmount: row.total_amount,
          itemCount: row.item_count,
          itemSummary: summarizeOrderItems(items.get(row.id) ?? []),
          urgency: urgency.urgency,
          urgencyReason: urgency.reason,
          receivedAt: isoOrNull(row.received_at),
          wantedAt: isoOrNull(row.wanted_at),
        };
      }),
    });
  },
);

// ---------- D-2 `hjdqV` 受注詳細 ----------

async function orderFor(
  c: Context<Env>,
  store: StoreContext,
  id: string,
): Promise<DeliveryOrderRow | null> {
  return dbFor(c.env, store.id)
    .prepare('SELECT * FROM rt_delivery_orders WHERE id = ? AND store_id = ? LIMIT 1')
    .bind(id, store.id)
    .first<DeliveryOrderRow>();
}

restaurantDelivery.get(
  '/api/restaurant-test/delivery/orders/:id',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const store = await deliveryStore(c);
    if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
    const order = await orderFor(c, store, c.req.param('id'));
    if (!order) return fail(c, 404, 'この注文は見つかりません');
    const now = nowSec();
    const [items, cookingCount] = await Promise.all([
      itemsForOrders(c, store, [order.id]),
      cookingCountFor(c, store),
    ]);
    // 急ぎ度は読み出しのたびに判定し直す。画面には結果と理由の文だけを出す。
    const urgency = judgeUrgency({
      status: order.status,
      receivedAt: order.received_at,
      wantedAt: order.wanted_at,
      itemCount: order.item_count,
      cookingCount,
      now,
    });
    return c.json({
      success: true,
      order: {
        id: order.id,
        service: order.service,
        serviceLabel: DELIVERY_SERVICE_LABELS[order.service],
        orderNumber: order.order_number,
        status: order.status,
        statusLabel: ORDER_STATUS_LABELS[order.status],
        totalAmount: order.total_amount,
        currency: order.currency,
        itemCount: order.item_count,
        urgency: urgency.urgency,
        urgencyReason: urgency.reason,
        // 受け取り情報。
        pickupMethod: order.pickup_method,
        wantedAt: isoOrNull(order.wanted_at),
        customerNote: order.customer_note,
        cancelReasonCode: order.cancel_reason_code,
        canceledBy: order.canceled_by,
        receivedAt: isoOrNull(order.received_at),
        acceptedAt: isoOrNull(order.accepted_at),
        readyAt: isoOrNull(order.ready_at),
        handedOverAt: isoOrNull(order.handed_over_at),
        canceledAt: isoOrNull(order.canceled_at),
      },
      items: (items.get(order.id) ?? []).map((item) => ({
        name: item.name,
        note: item.note,
        quantity: item.quantity,
        amount: item.amount,
      })),
    });
  },
);

// ---------- D-2/D-3 注文の操作（受注→調理中→準備完了→受け渡し済み／拒否／キャンセル） ----------

/** D-3のキャンセル理由。自由文は各サービスへ送らず、分類済みの符号だけを扱う。 */
const CANCEL_REASON_CODES = [
  'out_of_stock',
  'store_busy',
  'equipment_trouble',
  'customer_request',
  'other',
] as const;
type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

function isCancelReasonCode(value: unknown): value is CancelReasonCode {
  return typeof value === 'string' && (CANCEL_REASON_CODES as readonly string[]).includes(value);
}

/**
 * 注文の状態を1つ進める共通処理。
 *
 * 順番は必ず「台帳へ記録 → サービスへ送信 → 成功した時だけD1を進める」。
 * 送信が失敗した注文を画面上だけ進めてしまうと、店舗とサービスの状態がずれる。
 */
async function runOrderMutation(
  c: Context<Env>,
  input: {
    to: DeliveryOrderStatus;
    action: DeliveryAction;
    audit: AuditAction;
    timeColumn: 'accepted_at' | 'ready_at' | 'handed_over_at' | 'canceled_at' | null;
    cancel?: { reasonCode: CancelReasonCode; canceledBy: 'store' };
  },
) {
  const store = await deliveryStore(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const orderId = c.req.param('id');
  const order = orderId ? await orderFor(c, store, orderId) : null;
  if (!order) return fail(c, 404, 'この注文は見つかりません');
  const target = { id: order.id, kind: 'rt_delivery_order' };
  if (!canTransitionOrder(order.status, input.to)) {
    auditLog(c, input.audit, target, { result: 'denied', lineAccountId: order.account_id });
    return fail(
      c,
      409,
      `この注文は${ORDER_STATUS_LABELS[order.status]}のため、この操作はできません`,
      { code: 'INVALID_STATUS', status: order.status },
    );
  }

  const now = nowSec();
  const result = await sendWithLedger(c, store, {
    service: order.service,
    action: input.action,
    targetKind: 'order',
    targetId: order.id,
    externalId: order.external_order_id,
    body: input.cancel ? { reason_code: input.cancel.reasonCode } : undefined,
    now,
  });
  if (!result.ok) {
    auditLog(c, input.audit, target, { result: 'failed', lineAccountId: order.account_id });
    return dispatchFailure(c, result);
  }

  const sets = ['status = ?', 'updated_at = ?', 'version = version + 1'];
  const binds: unknown[] = [input.to, now];
  if (input.timeColumn) {
    sets.push(`${input.timeColumn} = ?`);
    binds.push(now);
  }
  if (input.cancel) {
    sets.push('cancel_reason_code = ?', 'canceled_by = ?');
    binds.push(input.cancel.reasonCode, input.cancel.canceledBy);
  }
  // 版と元の状態で絞る。同じ注文を2つの端末から進めた時は先の操作だけを通す。
  const updated = await dbFor(c.env, store.id)
    .prepare(
      `UPDATE rt_delivery_orders SET ${sets.join(', ')}
        WHERE id = ? AND store_id = ? AND status = ? AND version = ?`,
    )
    .bind(...binds, order.id, store.id, order.status, order.version)
    .run();
  if ((updated.meta?.changes ?? 0) === 0) {
    return fail(c, 409, 'ほかの端末がこの注文を進めました。画面を開き直してください', {
      code: 'STALE_ORDER',
    });
  }

  auditLog(c, input.audit, target, { lineAccountId: order.account_id });
  return c.json({
    success: true,
    order: {
      id: order.id,
      status: input.to,
      statusLabel: ORDER_STATUS_LABELS[input.to],
      updatedAt: isoOrNull(now),
    },
  });
}

restaurantDelivery.post(
  '/api/restaurant-test/delivery/orders/:id/accept',
  requireRole('owner', 'admin', 'staff'),
  async (c) =>
    runOrderMutation(c, {
      to: 'cooking',
      action: 'accept',
      audit: 'restaurant.delivery.order.accept',
      timeColumn: 'accepted_at',
    }),
);

restaurantDelivery.post(
  '/api/restaurant-test/delivery/orders/:id/ready',
  requireRole('owner', 'admin', 'staff'),
  async (c) =>
    runOrderMutation(c, {
      to: 'ready',
      action: 'ready',
      audit: 'restaurant.delivery.order.ready',
      timeColumn: 'ready_at',
    }),
);

restaurantDelivery.post(
  '/api/restaurant-test/delivery/orders/:id/handed-over',
  requireRole('owner', 'admin', 'staff'),
  async (c) =>
    runOrderMutation(c, {
      to: 'handed_over',
      action: 'handed_over',
      audit: 'restaurant.delivery.order.handed_over',
      timeColumn: 'handed_over_at',
    }),
);

// 拒否は注文そのものを断る操作。担当者には出さず、店舗管理者以上だけが押せる。
restaurantDelivery.post(
  '/api/restaurant-test/delivery/orders/:id/reject',
  requireRole('owner', 'admin'),
  async (c) =>
    runOrderMutation(c, {
      to: 'rejected',
      action: 'reject',
      audit: 'restaurant.delivery.order.reject',
      timeColumn: 'canceled_at',
    }),
);

// D-3 `dgeTy` キャンセル。取り消せないため確認手順（428）を必ず通す。
restaurantDelivery.post(
  '/api/restaurant-test/delivery/orders/:id/cancel',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation(CANCEL_CONFIRM_TOKEN),
  async (c) => {
    const body: { reason_code?: unknown } = await c.req
      .json<{ reason_code?: unknown }>()
      .catch(() => ({}));
    const reasonCode = body.reason_code;
    if (!isCancelReasonCode(reasonCode)) {
      return fail(c, 400, 'キャンセルの理由を選んでください', { code: 'REASON_REQUIRED' });
    }
    return runOrderMutation(c, {
      to: 'canceled',
      action: 'cancel',
      audit: 'restaurant.delivery.order.cancel',
      timeColumn: 'canceled_at',
      cancel: { reasonCode, canceledBy: 'store' },
    });
  },
);

// ---------- D-4 `OzHLO` 履歴とCSV ----------

/** 履歴の絞り込み。日付は日本時間、サービスと状態は選択肢だけを通す。 */
function historyFilter(c: Context<Env>, now: number):
  | { ok: true; from: number; to: number; fromText: string; toText: string;
      service: DeliveryService | null; status: DeliveryOrderStatus | null }
  | { ok: false; error: string } {
  const fromRange = tokyoDayRange(c.req.query('from'), now);
  const toRange = tokyoDayRange(c.req.query('to'), now);
  if (fromRange.from > toRange.from) {
    return { ok: false, error: '開始日は終了日より前にしてください' };
  }
  const serviceText = c.req.query('service');
  if (serviceText && !isDeliveryService(serviceText)) {
    return { ok: false, error: '対象のサービスが選べていません' };
  }
  const statusText = c.req.query('status');
  if (statusText && !(statusText in ORDER_STATUS_LABELS)) {
    return { ok: false, error: '対象の状態が選べていません' };
  }
  return {
    ok: true,
    from: fromRange.from,
    // 終了日はその日を含める。
    to: toRange.to,
    fromText: fromRange.dateText,
    toText: toRange.dateText,
    service: serviceText ? (serviceText as DeliveryService) : null,
    status: statusText ? (statusText as DeliveryOrderStatus) : null,
  };
}

function historyQuery(
  store: StoreContext,
  filter: Extract<ReturnType<typeof historyFilter>, { ok: true }>,
): { where: string; binds: unknown[] } {
  const binds: unknown[] = [store.id, filter.from, filter.to];
  let where = 'store_id = ? AND received_at >= ? AND received_at < ?';
  if (filter.service) {
    where += ' AND service = ?';
    binds.push(filter.service);
  }
  if (filter.status) {
    where += ' AND status = ?';
    binds.push(filter.status);
  }
  return { where, binds };
}

restaurantDelivery.get(
  '/api/restaurant-test/delivery/history',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const store = await deliveryStore(c);
    if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
    const now = nowSec();
    const filter = historyFilter(c, now);
    if (!filter.ok) return fail(c, 400, filter.error);
    const { where, binds } = historyQuery(store, filter);
    const db = dbFor(c.env, store.id);
    const [totals, serviceTotals, rows] = await Promise.all([
      // 件数と売上はキャンセル・拒否を除く（D-4の集計帯と足もとの件数は同じ数え方）。
      db
        .prepare(
          `SELECT SUM(CASE WHEN status IN ('canceled','rejected') THEN 0 ELSE 1 END) AS count,
                  COALESCE(SUM(CASE WHEN status NOT IN ('canceled','rejected')
                                    THEN total_amount ELSE 0 END), 0) AS amount,
                  SUM(CASE WHEN status IN ('canceled','rejected') THEN 1 ELSE 0 END) AS canceled
             FROM rt_delivery_orders WHERE ${where}`,
        )
        .bind(...binds)
        .first<{ count: number; amount: number; canceled: number }>(),
      // D-4の集計帯のサービス別。こちらも売上に数える注文だけ。
      db
        .prepare(
          `SELECT service, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
             FROM rt_delivery_orders
            WHERE ${where} AND status NOT IN ('canceled','rejected')
            GROUP BY service`,
        )
        .bind(...binds)
        .all<{ service: DeliveryService; count: number; amount: number }>(),
      db
        .prepare(
          `SELECT * FROM rt_delivery_orders WHERE ${where}
            ORDER BY received_at DESC LIMIT 200`,
        )
        .bind(...binds)
        .all<DeliveryOrderRow>(),
    ]);
    const serviceTotalMap = new Map(
      (serviceTotals.results ?? []).map((row) => [row.service, row]),
    );
    const orders = rows.results ?? [];
    const items = await itemsForOrders(
      c,
      store,
      orders.map((row) => row.id),
    );
    return c.json({
      success: true,
      range: { from: filter.fromText, to: filter.toText },
      filter: { service: filter.service, status: filter.status },
      totals: {
        count: totals?.count ?? 0,
        amount: totals?.amount ?? 0,
        canceledCount: totals?.canceled ?? 0,
        byService: DELIVERY_SERVICES.filter(
          (service) => !filter.service || service === filter.service,
        ).map((service) => ({
          service,
          label: DELIVERY_SERVICE_LABELS[service],
          count: serviceTotalMap.get(service)?.count ?? 0,
          amount: serviceTotalMap.get(service)?.amount ?? 0,
        })),
      },
      orders: orders.map((row) => ({
        id: row.id,
        service: row.service,
        serviceLabel: DELIVERY_SERVICE_LABELS[row.service],
        orderNumber: row.order_number,
        status: row.status,
        statusLabel: ORDER_STATUS_LABELS[row.status],
        totalAmount: row.total_amount,
        itemCount: row.item_count,
        itemSummary: summarizeOrderItems(items.get(row.id) ?? []),
        cancelReasonCode: row.cancel_reason_code,
        receivedAt: isoOrNull(row.received_at),
        handedOverAt: isoOrNull(row.handed_over_at),
      })),
    });
  },
);

restaurantDelivery.get(
  '/api/restaurant-test/delivery/history.csv',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const store = await deliveryStore(c);
    if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
    const now = nowSec();
    const filter = historyFilter(c, now);
    if (!filter.ok) return fail(c, 400, filter.error);
    const { where, binds } = historyQuery(store, filter);
    // 上限より1件多く引き、打ち切りが起きたかどうかを確かめる。
    const rows = await dbFor(c.env, store.id)
      .prepare(
        `SELECT * FROM rt_delivery_orders WHERE ${where}
          ORDER BY received_at DESC LIMIT ?`,
      )
      .bind(...binds, CSV_MAX_ROWS + 1)
      .all<DeliveryOrderRow>();
    const all = rows.results ?? [];
    const truncated = all.length > CSV_MAX_ROWS;
    const orders = truncated ? all.slice(0, CSV_MAX_ROWS) : all;
    const items = await itemsForOrders(
      c,
      store,
      orders.map((row) => row.id),
    );

    const header = [
      '受信日時',
      'サービス',
      '注文番号',
      '状態',
      '金額',
      '点数',
      '注文内容',
      'キャンセル理由',
      '受け渡し日時',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const row of orders) {
      lines.push(
        [
          csvCell(isoOrNull(row.received_at)),
          csvCell(DELIVERY_SERVICE_LABELS[row.service]),
          csvCell(row.order_number),
          csvCell(ORDER_STATUS_LABELS[row.status]),
          csvCell(row.total_amount),
          csvCell(row.item_count),
          csvCell(summarizeOrderItems(items.get(row.id) ?? [])),
          csvCell(row.cancel_reason_code),
          csvCell(isoOrNull(row.handed_over_at)),
        ].join(','),
      );
    }
    auditLog(
      c,
      'restaurant.delivery.history.export',
      { id: store.id, kind: 'rt_store' },
      { lineAccountId: store.lineAccountId },
    );
    const fileName = `delivery-orders_${filter.fromText}_${filter.toText}.csv`;
    const headers: Record<string, string> = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      'X-Row-Count': String(orders.length),
    };
    // 打ち切った時は画面に知らせ、期間を狭めてもらう。
    if (truncated) {
      headers['X-Truncated'] = 'true';
      headers['X-Row-Limit'] = String(CSV_MAX_ROWS);
    }
    // Excelで開いた時に文字化けしないようBOMを付ける。
    return c.body(`﻿${lines.join('\r\n')}\r\n`, 200, headers);
  },
);

// ---------- D-5 `h7OeT` 商品と品切れ一括 ----------

/** サービスごとの商品ID。連携していないサービスへは送らない。 */
function externalItemIds(row: DeliveryMenuItemRow): Partial<Record<DeliveryService, string>> {
  if (!row.external_item_ids_json) return {};
  try {
    const parsed = JSON.parse(row.external_item_ids_json) as Record<string, unknown>;
    const ids: Partial<Record<DeliveryService, string>> = {};
    for (const service of DELIVERY_SERVICES) {
      const value = parsed[service];
      if (typeof value === 'string' && value.trim()) ids[service] = value.trim();
    }
    return ids;
  } catch {
    // 壊れた記録で画面を止めない。連携なしとして扱う。
    return {};
  }
}

async function menuItemsFor(
  c: Context<Env>,
  store: StoreContext,
  ids?: string[],
): Promise<DeliveryMenuItemRow[]> {
  const db = dbFor(c.env, store.id);
  if (!ids) {
    const rows = await db
      .prepare(
        `SELECT id, store_id, name, category, price, sold_out, sold_out_at,
                sort_order, external_item_ids_json, version
           FROM rt_delivery_menu_items WHERE store_id = ?
          ORDER BY sort_order, name`,
      )
      .bind(store.id)
      .all<DeliveryMenuItemRow>();
    return rows.results ?? [];
  }
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT id, store_id, name, category, price, sold_out, sold_out_at,
              sort_order, external_item_ids_json, version
         FROM rt_delivery_menu_items WHERE store_id = ? AND id IN (${placeholders})
        ORDER BY sort_order, name`,
    )
    .bind(store.id, ...ids)
    .all<DeliveryMenuItemRow>();
  return rows.results ?? [];
}

restaurantDelivery.get(
  '/api/restaurant-test/delivery/menu-items',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const store = await deliveryStore(c);
    if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
    const rows = await menuItemsFor(c, store);
    return c.json({
      success: true,
      store: { id: store.id, name: store.name },
      items: rows.map((row) => {
        const ids = externalItemIds(row);
        return {
          id: row.id,
          name: row.name,
          category: row.category,
          price: row.price,
          soldOut: row.sold_out === 1,
          soldOutAt: isoOrNull(row.sold_out_at),
          // 連携済みのサービスだけを画面に出す。未連携の商品は一括操作の対象外。
          services: DELIVERY_SERVICES.filter((service) => ids[service]).map((service) => ({
            service,
            label: DELIVERY_SERVICE_LABELS[service],
          })),
        };
      }),
    });
  },
);

/**
 * 品切れ・再開の一括設定。1商品ごとに連携済みサービスへ順に送り、
 * すべて通った商品だけD1を更新する。1つでも失敗した商品は元の状態で残す。
 */
restaurantDelivery.post(
  '/api/restaurant-test/delivery/menu-items/bulk-sold-out',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const store = await deliveryStore(c);
    if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
    const body = await c.req
      .json<{ item_ids?: unknown; sold_out?: unknown }>()
      .catch(() => ({}) as { item_ids?: unknown; sold_out?: unknown });
    const requestedIds = Array.isArray(body.item_ids)
      ? body.item_ids.filter((value): value is string => typeof value === 'string' && !!value.trim())
      : [];
    if (requestedIds.length === 0) return fail(c, 400, '対象の商品を選んでください');
    if (requestedIds.length > 200) return fail(c, 400, '一度に設定できる商品は200件までです');
    if (typeof body.sold_out !== 'boolean') {
      return fail(c, 400, '品切れにするか、再開するかを選んでください');
    }
    const soldOut = body.sold_out;
    const rows = await menuItemsFor(c, store, requestedIds);
    if (rows.length === 0) return fail(c, 404, '対象の商品が見つかりません');

    const now = nowSec();
    const action: DeliveryAction = soldOut ? 'menu_sold_out' : 'menu_resume';
    const audit: AuditAction = soldOut
      ? 'restaurant.delivery.menu.sold_out'
      : 'restaurant.delivery.menu.resume';
    const updated: string[] = [];
    const failed: Array<{ id: string; name: string; code: string; retryable: boolean }> = [];
    const skipped: Array<{ id: string; name: string }> = [];

    for (const row of rows) {
      const ids = externalItemIds(row);
      const services = DELIVERY_SERVICES.filter((service) => ids[service]);
      if (services.length === 0) {
        skipped.push({ id: row.id, name: row.name });
        continue;
      }
      let firstError: Extract<DeliveryDispatchResult, { ok: false }> | null = null;
      for (const service of services) {
        const result = await sendWithLedger(c, store, {
          service,
          action,
          targetKind: 'menu_item',
          targetId: row.id,
          externalId: ids[service] ?? null,
          body: { sold_out: soldOut },
          now,
        });
        if (!result.ok) {
          firstError = result;
          break;
        }
      }
      if (firstError) {
        failed.push({
          id: row.id,
          name: row.name,
          code: firstError.error.code,
          retryable: firstError.error.retryable,
        });
        continue;
      }
      await dbFor(c.env, store.id)
        .prepare(
          `UPDATE rt_delivery_menu_items
              SET sold_out = ?, sold_out_at = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND store_id = ?`,
        )
        .bind(soldOut ? 1 : 0, soldOut ? now : null, now, row.id, store.id)
        .run();
      updated.push(row.id);
    }

    auditLog(
      c,
      audit,
      { id: store.id, kind: 'rt_store' },
      {
        result: updated.length > 0 ? 'success' : 'failed',
        lineAccountId: store.lineAccountId,
      },
    );
    if (updated.length === 0 && failed.length > 0) {
      const first = failed[0];
      return fail(
        c,
        first.retryable ? 503 : 502,
        '各サービスへ送れませんでした。しばらくしてからもう一度お試しください',
        { code: first.code, retryable: first.retryable, failed, skipped },
      );
    }
    return c.json({ success: true, soldOut, updated, failed, skipped });
  },
);

// ---------- D-6 `XCVGd` 受付の一括停止と再開 ----------

/** 対象サービス。指定が無ければ3サービスすべて。 */
function targetServices(value: unknown): DeliveryService[] | null {
  if (value === undefined || value === null) return [...DELIVERY_SERVICES];
  if (!Array.isArray(value) || value.length === 0) return null;
  const services: DeliveryService[] = [];
  for (const entry of value) {
    if (!isDeliveryService(entry)) return null;
    if (!services.includes(entry)) services.push(entry);
  }
  return services;
}

async function upsertIntake(
  c: Context<Env>,
  store: StoreContext,
  service: DeliveryService,
  input:
    | { intake: 'stopped'; stopUntil: number; requestedBy: string; now: number }
    | { intake: 'open'; now: number },
): Promise<void> {
  const db = dbFor(c.env, store.id);
  if (input.intake === 'stopped') {
    await db
      .prepare(
        `INSERT INTO rt_delivery_service_states
           (account_id, store_id, service, intake_status, stop_until,
            stop_requested_at, stop_requested_by, created_at, updated_at)
         VALUES (?, ?, ?, 'stopped', ?, ?, ?, ?, ?)
         ON CONFLICT(store_id, service) DO UPDATE SET
           intake_status = 'stopped', stop_until = excluded.stop_until,
           stop_requested_at = excluded.stop_requested_at,
           stop_requested_by = excluded.stop_requested_by,
           version = version + 1, updated_at = excluded.updated_at`,
      )
      .bind(
        store.lineAccountId,
        store.id,
        service,
        input.stopUntil,
        input.now,
        input.requestedBy,
        input.now,
        input.now,
      )
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO rt_delivery_service_states
         (account_id, store_id, service, intake_status, resumed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?)
       ON CONFLICT(store_id, service) DO UPDATE SET
         intake_status = 'open', stop_until = NULL,
         resumed_at = excluded.resumed_at,
         version = version + 1, updated_at = excluded.updated_at`,
    )
    .bind(store.lineAccountId, store.id, service, input.now, input.now, input.now)
    .run();
}

// 受付を止めると新しい注文が入らなくなる。確認手順（428）を通し、店舗管理者以上だけが押せる。
restaurantDelivery.post(
  '/api/restaurant-test/delivery/intake/stop',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation(INTAKE_STOP_CONFIRM_TOKEN),
  async (c) => {
    const store = await deliveryStore(c);
    if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
    const body = await c.req
      .json<{ services?: unknown; preset?: unknown }>()
      .catch(() => ({}) as { services?: unknown; preset?: unknown });
    if (!isIntakeStopPreset(body.preset)) {
      return fail(c, 400, '停止する長さを選んでください');
    }
    const services = targetServices(body.services);
    if (!services) return fail(c, 400, '対象のサービスが選べていません');

    const now = nowSec();
    const stopUntil = intakeStopUntil(body.preset, now);
    const stopped: DeliveryService[] = [];
    const failed: Array<{ service: DeliveryService; code: string; retryable: boolean }> = [];
    for (const service of services) {
      const result = await sendWithLedger(c, store, {
        service,
        action: 'intake_stop',
        targetKind: 'service',
        targetId: service,
        body: { stop_until: stopUntil },
        now,
      });
      if (!result.ok) {
        failed.push({
          service,
          code: result.error.code,
          retryable: result.error.retryable,
        });
        continue;
      }
      await upsertIntake(c, store, service, {
        intake: 'stopped',
        stopUntil,
        requestedBy: c.get('staff')?.id ?? 'unknown',
        now,
      });
      stopped.push(service);
    }

    auditLog(
      c,
      'restaurant.delivery.intake.stop',
      { id: store.id, kind: 'rt_store' },
      {
        result: stopped.length > 0 ? 'success' : 'failed',
        lineAccountId: store.lineAccountId,
      },
    );
    if (stopped.length === 0) {
      const first = failed[0];
      return fail(
        c,
        first?.retryable ? 503 : 502,
        '各サービスへ送れませんでした。しばらくしてからもう一度お試しください',
        { code: first?.code ?? 'delivery_send_failed', retryable: first?.retryable ?? false, failed },
      );
    }
    return c.json({
      success: true,
      preset: body.preset,
      stopUntil: isoOrNull(stopUntil),
      stopped,
      failed,
    });
  },
);

restaurantDelivery.post(
  '/api/restaurant-test/delivery/intake/resume',
  requireRole('owner', 'admin'),
  async (c) => {
    const store = await deliveryStore(c);
    if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
    const body = await c.req
      .json<{ services?: unknown }>()
      .catch(() => ({}) as { services?: unknown });
    const services = targetServices(body.services);
    if (!services) return fail(c, 400, '対象のサービスが選べていません');

    const now = nowSec();
    const resumed: DeliveryService[] = [];
    const failed: Array<{ service: DeliveryService; code: string; retryable: boolean }> = [];
    for (const service of services) {
      const result = await sendWithLedger(c, store, {
        service,
        action: 'intake_resume',
        targetKind: 'service',
        targetId: service,
        now,
      });
      if (!result.ok) {
        failed.push({
          service,
          code: result.error.code,
          retryable: result.error.retryable,
        });
        continue;
      }
      await upsertIntake(c, store, service, { intake: 'open', now });
      resumed.push(service);
    }

    auditLog(
      c,
      'restaurant.delivery.intake.resume',
      { id: store.id, kind: 'rt_store' },
      {
        result: resumed.length > 0 ? 'success' : 'failed',
        lineAccountId: store.lineAccountId,
      },
    );
    if (resumed.length === 0) {
      const first = failed[0];
      return fail(
        c,
        first?.retryable ? 503 : 502,
        '各サービスへ送れませんでした。しばらくしてからもう一度お試しください',
        { code: first?.code ?? 'delivery_send_failed', retryable: first?.retryable ?? false, failed },
      );
    }
    return c.json({ success: true, resumed, failed });
  },
);

// ---------- 受信（各サービスの公式窓口からの通知） ----------

const MAX_WEBHOOK_BODY_BYTES = 128 * 1024;
/** 署名の時刻ずれの許容。他の受信口（EC連携・成果受信）と同じ5分。 */
const WEBHOOK_SKEW_SECONDS = 5 * 60;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** 文字列の必須項目。長さ上限を超えた値は受け取らない（画面の崩れとDB肥大を防ぐ）。 */
function textField(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  return textField(value, max);
}

function countField(value: unknown, max: number): number | null {
  if (!Number.isSafeInteger(value)) return null;
  const num = Number(value);
  if (num < 0 || num > max) return null;
  return num;
}

/** エポック秒。範囲外・形式違いは null にして、呼び出し側で既定値へ落とす。 */
function epochField(value: unknown, now: number): number | null {
  if (!Number.isSafeInteger(value)) return null;
  const num = Number(value);
  // 過去30日〜未来7日の外は受け取らない（誤った単位・ミリ秒混入を弾く）。
  if (num < now - 30 * 86400 || num > now + 7 * 86400) return null;
  return num;
}

interface WebhookItem {
  name: string;
  note: string | null;
  quantity: number;
  amount: number;
}

interface WebhookOrder {
  externalOrderId: string;
  orderNumber: string;
  totalAmount: number;
  pickupMethod: string | null;
  wantedAt: number | null;
  customerNote: string | null;
  receivedAt: number;
  items: WebhookItem[];
}

interface WebhookPayload {
  eventId: string;
  eventType: string;
  storeId: string;
  order: WebhookOrder | null;
  cancel: { externalOrderId: string; canceledBy: 'customer' | 'service' } | null;
}

/**
 * 3サービス共通の受信形式。
 * サービスごとの項目名の違いは各サービスの窓口設定側で共通名へ寄せる。
 * ここで受け取るのは検証済みの項目だけで、サービスから届いた自由文の
 * エラー文や説明文は取り込まない。
 */
function parseWebhookPayload(
  raw: unknown,
  now: number,
): { ok: true; payload: WebhookPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid payload' };
  const body = raw as Record<string, unknown>;
  const eventId = textField(body.event_id, 128);
  const eventType = textField(body.event_type, 64);
  const storeId = textField(body.store_id, 128);
  if (!eventId || !eventType || !storeId) return { ok: false, error: 'Invalid payload' };

  let order: WebhookOrder | null = null;
  if (body.order && typeof body.order === 'object') {
    const source = body.order as Record<string, unknown>;
    const externalOrderId = textField(source.external_order_id, 128);
    const orderNumber = textField(source.order_number, 64);
    const totalAmount = countField(source.total_amount, 10_000_000);
    if (!externalOrderId || !orderNumber || totalAmount === null) {
      return { ok: false, error: 'Invalid order' };
    }
    const items: WebhookItem[] = [];
    if (Array.isArray(source.items)) {
      if (source.items.length > 100) return { ok: false, error: 'Invalid order' };
      for (const entry of source.items) {
        if (!entry || typeof entry !== 'object') return { ok: false, error: 'Invalid order' };
        const item = entry as Record<string, unknown>;
        const name = textField(item.name, 200);
        const quantity = countField(item.quantity, 999);
        const amount = countField(item.amount, 10_000_000);
        if (!name || quantity === null || quantity === 0 || amount === null) {
          return { ok: false, error: 'Invalid order' };
        }
        items.push({ name, note: optionalText(item.note, 200), quantity, amount });
      }
    }
    order = {
      externalOrderId,
      orderNumber,
      totalAmount,
      pickupMethod: optionalText(source.pickup_method, 100),
      wantedAt: epochField(source.wanted_at, now),
      customerNote: optionalText(source.customer_note, 500),
      receivedAt: epochField(source.received_at, now) ?? now,
      items,
    };
  }

  let cancel: WebhookPayload['cancel'] = null;
  if (body.cancel && typeof body.cancel === 'object') {
    const source = body.cancel as Record<string, unknown>;
    const externalOrderId = textField(source.external_order_id, 128);
    if (!externalOrderId) return { ok: false, error: 'Invalid cancel' };
    // 発生元は店舗以外の2つだけ。店舗のキャンセルは画面（D-3）から記録する。
    const canceledBy = source.canceled_by === 'customer' ? 'customer' : 'service';
    cancel = { externalOrderId, canceledBy };
  }

  return { ok: true, payload: { eventId, eventType, storeId, order, cancel } };
}

/** 署名検証を通った通知の宛先店舗。担当者の認証は通らないため、ここで店舗を確定する。 */
async function webhookStore(c: Context<Env>, storeId: string): Promise<StoreContext | null> {
  const row = await dbFor(c.env, storeId)
    .prepare(
      `SELECT id, name, organization_id, line_account_id
         FROM rt_stores WHERE id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(storeId)
    .first<{ id: string; name: string; organization_id: string; line_account_id: string | null }>();
  if (!row || !row.line_account_id) return null;
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organization_id,
    lineAccountId: row.line_account_id,
  };
}

/** 新しい注文をD1へ取り込む。重複は UNIQUE (service, external_order_id) で1件に収める。 */
async function ingestOrder(
  c: Context<Env>,
  store: StoreContext,
  service: DeliveryService,
  order: WebhookOrder,
  now: number,
): Promise<'created' | 'duplicate'> {
  const db = dbFor(c.env, store.id);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const cookingCount = await cookingCountFor(c, store);
  const urgency = judgeUrgency({
    status: 'new',
    receivedAt: order.receivedAt,
    wantedAt: order.wantedAt,
    itemCount,
    cookingCount,
    now,
  });
  const id = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO rt_delivery_orders
         (id, account_id, store_id, service, external_order_id, order_number, status,
          total_amount, currency, item_count, pickup_method, wanted_at, customer_note,
          urgency, urgency_reason, urgency_computed_at, received_at,
          version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?, 'JPY', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      store.lineAccountId,
      store.id,
      service,
      order.externalOrderId,
      order.orderNumber,
      order.totalAmount,
      itemCount,
      order.pickupMethod,
      order.wantedAt,
      order.customerNote,
      urgency.urgency,
      urgency.reason,
      now,
      order.receivedAt,
      now,
      now,
    )
    .run();
  if ((inserted.meta?.changes ?? 0) === 0) return 'duplicate';

  for (const [index, item] of order.items.entries()) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO rt_delivery_order_items
           (id, order_id, position, name, note, quantity, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), id, index, item.name, item.note, item.quantity, item.amount, now)
      .run();
  }
  return 'created';
}

/**
 * お客様・サービス側からのキャンセル。店舗へ送り返す操作ではないため送信台帳は使わない。
 * 理由は自社の符号へ寄せる（サービスから届いた自由文は保存しない）。
 */
async function ingestCancel(
  c: Context<Env>,
  store: StoreContext,
  service: DeliveryService,
  cancel: { externalOrderId: string; canceledBy: 'customer' | 'service' },
  now: number,
): Promise<'canceled' | 'ignored'> {
  const db = dbFor(c.env, store.id);
  const row = await db
    .prepare(
      `SELECT id, status, version FROM rt_delivery_orders
        WHERE store_id = ? AND service = ? AND external_order_id = ? LIMIT 1`,
    )
    .bind(store.id, service, cancel.externalOrderId)
    .first<{ id: string; status: DeliveryOrderStatus; version: number }>();
  if (!row) return 'ignored';
  if (!canTransitionOrder(row.status, 'canceled')) return 'ignored';
  const reasonCode = cancel.canceledBy === 'customer' ? 'customer_request' : 'service_canceled';
  const updated = await db
    .prepare(
      `UPDATE rt_delivery_orders
          SET status = 'canceled', canceled_at = ?, cancel_reason_code = ?, canceled_by = ?,
              version = version + 1, updated_at = ?
        WHERE id = ? AND store_id = ? AND status = ? AND version = ?`,
    )
    .bind(now, reasonCode, cancel.canceledBy, now, row.id, store.id, row.status, row.version)
    .run();
  return (updated.meta?.changes ?? 0) > 0 ? 'canceled' : 'ignored';
}

/**
 * 各サービスからの通知の受け口。
 *
 * 担当者の認証は通らない。守りは3つで、
 * 1) サービスごとの合言葉によるHMAC-SHA256の署名検証、
 * 2) 5分の時刻ずれ制限、
 * 3) 受信台帳 `rt_delivery_events` の UNIQUE (service, external_event_id) による重複排除。
 * 署名が合わない通知は本文を保存しない。
 */
restaurantDelivery.post('/api/restaurant-test/delivery/webhooks/:service', async (c) => {
  const service = c.req.param('service');
  if (!isDeliveryService(service)) {
    return c.json({ success: false, error: 'Unknown service' }, 404);
  }
  const secret = deliveryWebhookSecret(c.env, service);
  if (!secret) {
    // 合言葉が未設定・短すぎる場合は検証できない。受け取らずに設定不足として返す。
    console.error('[rt-delivery] webhook secret is not configured', JSON.stringify({ service }));
    return c.json({ success: false, error: 'Integration is not configured' }, 503);
  }

  const declaredLength = Number(c.req.header('content-length') || '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }
  const rawBody = await c.req.text();
  if (utf8Length(rawBody) > MAX_WEBHOOK_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }

  const timestamp = c.req.header('x-nen-timestamp') || '';
  const timestampSeconds = Number(timestamp);
  const now = nowSec();
  if (!Number.isInteger(timestampSeconds) || Math.abs(now - timestampSeconds) > WEBHOOK_SKEW_SECONDS) {
    return c.json({ success: false, error: 'Expired request' }, 401);
  }
  const signature = (c.req.header('x-nen-signature') || '').replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(signature)) {
    return c.json({ success: false, error: 'Invalid signature' }, 401);
  }
  const expected = await computeHmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  if (!safeEqualHex(signature, expected)) {
    return c.json({ success: false, error: 'Invalid signature' }, 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }
  const parsed = parseWebhookPayload(parsedJson, now);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
  const payload = parsed.payload;

  const store = await webhookStore(c, payload.storeId);
  if (!store) return c.json({ success: false, error: 'Store is not configured' }, 404);

  const db = dbFor(c.env, store.id);
  const externalOrderId = payload.order?.externalOrderId ?? payload.cancel?.externalOrderId ?? null;
  // 先に受信台帳へ入れる。同じ通知が二度届いても処理は1回だけになる。
  const ledger = await db
    .prepare(
      `INSERT OR IGNORE INTO rt_delivery_events
         (id, account_id, service, external_event_id, event_type, external_order_id,
          status, payload_json, attempts, received_at, version)
       VALUES (?, ?, ?, ?, ?, ?, 'received', ?, 1, ?, 1)`,
    )
    .bind(
      crypto.randomUUID(),
      store.lineAccountId,
      service,
      payload.eventId,
      payload.eventType,
      externalOrderId,
      rawBody,
      now,
    )
    .run();
  if ((ledger.meta?.changes ?? 0) === 0) {
    // すでに受け取った通知。再送でも同じ200を返して相手の再試行を止める。
    return c.json({ success: true, duplicate: true });
  }

  const closeEvent = async (
    status: 'processed' | 'ignored' | 'failed' | 'retryable_failed',
    errorCode: string | null,
  ) => {
    await db
      .prepare(
        `UPDATE rt_delivery_events
            SET status = ?, error_code = ?, processed_at = ?, version = version + 1
          WHERE service = ? AND external_event_id = ?`,
      )
      .bind(status, errorCode, nowSec(), service, payload.eventId)
      .run();
  };

  try {
    if (payload.eventType === 'order.created') {
      if (!payload.order) {
        await closeEvent('failed', 'order_missing');
        return c.json({ success: false, error: 'Invalid order' }, 400);
      }
      const outcome = await ingestOrder(c, store, service, payload.order, now);
      await closeEvent('processed', null);
      return c.json({ success: true, result: outcome });
    }
    if (payload.eventType === 'order.canceled') {
      if (!payload.cancel) {
        await closeEvent('failed', 'cancel_missing');
        return c.json({ success: false, error: 'Invalid cancel' }, 400);
      }
      const outcome = await ingestCancel(c, store, service, payload.cancel, now);
      await closeEvent(outcome === 'canceled' ? 'processed' : 'ignored', null);
      return c.json({ success: true, result: outcome });
    }
    // 対応していない種類は記録だけ残して受け取る（相手の再送を止めるため200）。
    await closeEvent('ignored', null);
    return c.json({ success: true, result: 'ignored' });
  } catch (error) {
    // 例外の本文は残さない。種類だけを符号にして台帳へ入れ、相手には再試行を促す。
    console.error(
      '[rt-delivery] webhook processing failed',
      JSON.stringify({ service, name: error instanceof Error ? error.name : 'unknown' }),
    );
    await closeEvent('retryable_failed', 'processing_failed');
    return c.json({ success: false, error: 'Processing failed' }, 503);
  }
});
