/**
 * 運営ダッシュボード（★V6 37-2）の集計。
 *
 * 金額は「契約中プランの定価」で数える（決定 2026-09-17: Stripe の実売上は後で差し替え）。
 * 定価そのものは worker の billing-plans にあるので、ここは件数と期間の切り分けだけを持ち、
 * 金額への換算は呼び出し側で行う。日付は JST の ISO 文字列で比較する（表の created_at と同じ形）。
 */

export interface TenantPlanRow {
  id: string;
  name: string;
  status: string;
  plan_key: string | null;
  plan_status: string;
  trial_ends_at: string | null;
  created_at: string;
  plan_updated_at: string | null;
}

/** 運営会社（既定の統括）を除いた契約先。 */
export async function listContractTenants(db: D1Database, excludeTenantId: string): Promise<TenantPlanRow[]> {
  const { results } = await db
    .prepare(`SELECT id, name, status, plan_key, plan_status, trial_ends_at, created_at, plan_updated_at
                FROM tenants WHERE id <> ? AND status <> 'archived' ORDER BY created_at ASC`)
    .bind(excludeTenantId)
    .all<TenantPlanRow>();
  return results ?? [];
}

/** 期間内に受け取った Stripe の出来事の件数（type ごと・統括の重複なし）。 */
export async function countBillingEventsByType(
  db: D1Database,
  input: { from: string; to: string; types: string[] },
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (input.types.length === 0) return out;
  const marks = input.types.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT type, COUNT(DISTINCT tenant_id) AS n FROM billing_events
               WHERE received_at >= ? AND received_at < ? AND type IN (${marks}) GROUP BY type`)
    .bind(input.from, input.to, ...input.types)
    .all<{ type: string; n: number }>();
  for (const row of results ?? []) out[row.type] = row.n;
  return out;
}

/** 解約の日付（Stripe の customer.subscription.deleted を受けた日）を統括ごとに。 */
export async function canceledAtByTenant(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(`SELECT tenant_id, MAX(received_at) AS at FROM billing_events
               WHERE type = 'customer.subscription.deleted' AND tenant_id IS NOT NULL GROUP BY tenant_id`)
    .all<{ tenant_id: string; at: string }>();
  const out = new Map<string, string>();
  for (const row of results ?? []) out.set(row.tenant_id, row.at);
  return out;
}

export interface DashboardAlerts {
  pastDue: number;
  trialEndingSoon: number;
  lineTokenExpiring: number;
  unansweredTickets: number;
}

export async function dashboardAlerts(
  db: D1Database,
  input: { excludeTenantId: string; now: string; trialDeadline: string; tokenDeadline: string },
): Promise<DashboardAlerts> {
  const row = await db
    .prepare(`SELECT
                (SELECT COUNT(*) FROM tenants t WHERE t.id <> ? AND t.status <> 'archived' AND t.plan_status = 'past_due') AS past_due,
                (SELECT COUNT(*) FROM tenants t WHERE t.id <> ? AND t.status <> 'archived' AND t.plan_status = 'trialing'
                    AND t.trial_ends_at IS NOT NULL AND t.trial_ends_at >= ? AND t.trial_ends_at <= ?) AS trial_soon,
                (SELECT COUNT(*) FROM line_accounts la WHERE la.archived_at IS NULL AND la.token_expires_at IS NOT NULL
                    AND la.token_expires_at <= ?) AS token_soon,
                (SELECT COUNT(*) FROM hq_support_requests h WHERE h.stage = 'new') AS unanswered`)
    .bind(input.excludeTenantId, input.excludeTenantId, input.now, input.trialDeadline, input.tokenDeadline)
    .first<{ past_due: number; trial_soon: number; token_soon: number; unanswered: number }>();
  return {
    pastDue: row?.past_due ?? 0,
    trialEndingSoon: row?.trial_soon ?? 0,
    lineTokenExpiring: row?.token_soon ?? 0,
    unansweredTickets: row?.unanswered ?? 0,
  };
}

export interface DashboardTicketSummary {
  newCount: number;
  inProgressCount: number;
  avgFirstReplyMinutes: number | null;
  closedInPeriod: number;
}

export async function dashboardTickets(db: D1Database, input: { from: string; to: string }): Promise<DashboardTicketSummary> {
  const row = await db
    .prepare(`SELECT
                SUM(CASE WHEN stage = 'new' THEN 1 ELSE 0 END) AS new_n,
                SUM(CASE WHEN stage = 'in_progress' THEN 1 ELSE 0 END) AS prog_n,
                AVG(CASE WHEN first_replied_at IS NOT NULL AND created_at >= ? AND created_at < ?
                         THEN (julianday(first_replied_at) - julianday(created_at)) * 1440 END) AS first_reply,
                SUM(CASE WHEN COALESCE(closed_at, resolved_at) >= ? AND COALESCE(closed_at, resolved_at) < ? THEN 1 ELSE 0 END) AS closed_n
              FROM hq_support_requests`)
    .bind(input.from, input.to, input.from, input.to)
    .first<{ new_n: number | null; prog_n: number | null; first_reply: number | null; closed_n: number | null }>();
  return {
    newCount: row?.new_n ?? 0,
    inProgressCount: row?.prog_n ?? 0,
    avgFirstReplyMinutes: row?.first_reply ?? null,
    closedInPeriod: row?.closed_n ?? 0,
  };
}

/** 契約先の権限者のうち契約者専用LINE（★V6 37-7）に登録した人数。`staff_members.notice_friend_id` で数える。 */
export async function dashboardLineRegistration(
  db: D1Database,
  excludeTenantId: string,
): Promise<{ registered: number; total: number; unregistered: Array<{ staffId: string; name: string; email: string | null; tenantName: string }> }> {
  const total = await db
    .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN sm.notice_friend_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
                FROM staff_members sm JOIN tenants t ON t.id = sm.tenant_id
               WHERE sm.is_active = 1 AND t.id <> ? AND t.status <> 'archived'`)
    .bind(excludeTenantId)
    .first<{ n: number; linked: number | null }>();
  const { results } = await db
    .prepare(`SELECT sm.id AS staff_id, sm.name, sm.email, t.name AS tenant_name
                FROM staff_members sm JOIN tenants t ON t.id = sm.tenant_id
               WHERE sm.is_active = 1 AND sm.notice_friend_id IS NULL AND t.id <> ? AND t.status <> 'archived'
               ORDER BY t.name, sm.name LIMIT 200`)
    .bind(excludeTenantId)
    .all<{ staff_id: string; name: string; email: string | null; tenant_name: string }>();
  return {
    registered: total?.linked ?? 0,
    total: total?.n ?? 0,
    unregistered: (results ?? []).map((r) => ({ staffId: r.staff_id, name: r.name, email: r.email, tenantName: r.tenant_name })),
  };
}

export interface TenantUsageRow {
  tenant_id: string;
  tenant_name: string;
  plan_key: string | null;
  plan_status: string;
  messages: number;
  banner_units: number;
  media_bytes: number;
}

/** 期間内の使用量（配信通数・バナー生成・メディア容量）を契約先ごとに。 */
export async function dashboardUsage(
  db: D1Database,
  input: { excludeTenantId: string; from: string; to: string },
): Promise<TenantUsageRow[]> {
  const { results } = await db
    .prepare(`SELECT t.id AS tenant_id, t.name AS tenant_name, t.plan_key, t.plan_status,
                (SELECT COUNT(*) FROM messages_log ml JOIN line_accounts la ON la.id = ml.line_account_id
                   WHERE la.tenant_id = t.id AND ml.direction = 'outgoing' AND ml.created_at >= ? AND ml.created_at < ?) AS messages,
                (SELECT COALESCE(SUM(CASE WHEN reason = 'refund' THEN -units ELSE units END), 0) FROM banner_usage_ledger bl
                   WHERE bl.tenant_id = t.id AND bl.created_at >= ? AND bl.created_at < ?) AS banner_units,
                (SELECT COALESCE(SUM(m.size_bytes), 0) FROM media m JOIN line_accounts la ON la.id = m.line_account_id
                   WHERE la.tenant_id = t.id) AS media_bytes
              FROM tenants t
             WHERE t.id <> ? AND t.status <> 'archived'`)
    .bind(input.from, input.to, input.from, input.to, input.excludeTenantId)
    .all<TenantUsageRow>();
  return results ?? [];
}
