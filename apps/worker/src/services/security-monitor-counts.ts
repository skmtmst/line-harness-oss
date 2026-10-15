import type { SecurityRuleKey } from './security-monitor-rules.js';

export type SecurityCount = { tenant_id: string; line_account_id: string | null; rule_key: SecurityRuleKey; count: number; latest_event_at?: number };

// Legacy audit timestamps without an offset are JST wall time; new ISO values may be UTC.
const AUDIT_TIME = `julianday(CASE WHEN substr(created_at, 20) NOT GLOB '*[Z+-]*' THEN created_at || '+09:00' ELSE created_at END)`;
const BASE = `SELECT tenant_id, line_account_id, category, action, result, after_json, ${AUDIT_TIME} AS utc_at
  FROM audit_events WHERE created_at >= ? AND created_at < ?`;
const CONDITIONS: Record<Exclude<SecurityRuleKey, 'impersonation' | 'export_records'>, string> = {
  login_failures: `category = 'auth' AND (action = 'auth.fail' OR (action IN ('auth.login', 'auth.mfa.verify') AND result != 'success'))`,
  api_mutations: `category = 'business' AND action GLOB 'api.*'`,
  export_requests: `action IN ('data.export', 'form_document.download', 'auth.export') AND result = 'success'`,
  permission_changes: `result = 'success' AND (action GLOB 'api.patch./api/staff/*' OR action GLOB 'api.put./api/staff/*' OR action GLOB 'api.*./api/access/users/*' OR action GLOB 'auth.permissions.*')`,
  admin_additions: `result = 'success' AND action IN ('api.post./api/staff', 'api.post./api/access/users')`,
  key_rotations: `result = 'success' AND action IN ('auth.api_key.rotate', 'auth.api_key.revoke', 'auth.mfa.reenroll', 'auth.mfa.recovery.regenerate', 'auth.mfa.policy')`,
  night_activity: `category = 'business' AND CAST(strftime('%H', utc_at, '+9 hours') AS INTEGER) < 6`,
};

export async function collectSecurityCounts(db: D1Database, now: Date): Promise<SecurityCount[]> {
  const until = now.toISOString();
  const since = new Date(now.getTime() - 15 * 60000).toISOString();
  // Include all possible local dates for ISO offsets from -14h to +14h, then
  // enforce the exact 15 minutes below. Plain indexes also work with test clocks.
  const candidateFrom = new Date(Date.parse(since) - 14 * 3600000).toISOString().slice(0, 10);
  const candidateTo = new Date(now.getTime() + 38 * 3600000).toISOString().slice(0, 10);
  const counts: SecurityCount[] = [];
  const expressions = Object.entries(CONDITIONS).flatMap(([key, condition]) => [
    `SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END) AS ${key}`,
    `MAX(CASE WHEN ${condition} THEN utc_at ELSE NULL END) AS ${key}_latest`,
  ]);
  const metrics = await db.prepare(`WITH recent AS (${BASE})
    SELECT tenant_id, line_account_id, ${expressions.join(', ')} FROM recent
    WHERE utc_at > julianday(?) AND utc_at <= julianday(?) GROUP BY tenant_id, line_account_id`)
    .bind(candidateFrom, candidateTo, since, until).all<{ tenant_id: string; line_account_id: string | null } & Record<SecurityRuleKey, number>>();
  for (const row of metrics.results) {
    for (const key of Object.keys(CONDITIONS) as Array<keyof typeof CONDITIONS>) {
      counts.push({ tenant_id: row.tenant_id, line_account_id: row.line_account_id, rule_key: key, count: Number(row[key]), latest_event_at: Number((row as Record<string, unknown>)[`${key}_latest`]) });
    }
  }
  const exports = await db.prepare(`WITH recent AS (${BASE})
    SELECT tenant_id, line_account_id, MAX(utc_at) AS latest_event_at,
      SUM(CASE WHEN json_valid(after_json) AND json_type(after_json, '$.count') IN ('integer', 'real')
        THEN MAX(0, CAST(json_extract(after_json, '$.count') AS INTEGER)) ELSE 0 END) AS count
    FROM recent WHERE utc_at > julianday(?) AND utc_at <= julianday(?)
      AND action = 'data.export' AND result = 'success'
    GROUP BY tenant_id, line_account_id`).bind(candidateFrom, candidateTo, since, until).all<Omit<SecurityCount, 'rule_key'>>();
  counts.push(...exports.results.map(row => ({ ...row, rule_key: 'export_records' as const })));
  // Platform records include hidden read-only impersonation; never expose them through store APIs.
  const platform = await db.prepare(`SELECT COALESCE(tenant_id, '') AS tenant_id, NULL AS line_account_id, COUNT(*) AS count, MAX(${AUDIT_TIME}) AS latest_event_at
    FROM platform_audit_logs WHERE created_at >= ? AND created_at < ?
      AND ${AUDIT_TIME} > julianday(?) AND ${AUDIT_TIME} <= julianday(?)
      AND action IN ('impersonation.start', 'impersonation.write', 'pii.reveal')
    GROUP BY tenant_id`).bind(candidateFrom, candidateTo, since, until).all<Omit<SecurityCount, 'rule_key'>>();
  counts.push(...platform.results.map(row => ({ ...row, rule_key: 'impersonation' as const })));
  return counts;
}
