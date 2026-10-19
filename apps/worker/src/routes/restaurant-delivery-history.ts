import type { DeliveryOrderRow } from './restaurant-delivery-types.js';
import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import { dbFor } from '../services/db-router.js';
import { accountId, fail } from './restaurant-google.js';
import type { StoreContext } from './restaurant-google.js';
import { DELIVERY_SERVICES, DELIVERY_SERVICE_LABELS, isDeliveryService, nowSec, summarizeOrderItems, tokyoDayRange } from '../services/restaurant-delivery.js';
import type { DeliveryOrderStatus } from '../services/restaurant-delivery.js';
import type { DeliveryService } from '../services/delivery-service-types.js';
import { CSV_MAX_ROWS, csvCell, ORDER_STATUS_LABELS, isoOrNull, deliveryStore, itemsForOrders } from './restaurant-delivery-common.js';

export function registerDeliveryHistory(restaurantDelivery: Hono<Env>): void {
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
      c.set('outputAudit', { count: orders.length, accountId: store.lineAccountId, targetId: store.id });
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
}
