import { lineTokenExpiry, lineWebhookSilence, DEFAULT_TENANT_ID } from '@line-crm/shared';
import { type LineAccountConnectionIssue, type LineAccountListStats } from './line-accounts-types.js';


export const CONNECTION_ISSUE_ORDER: LineAccountConnectionIssue['kind'][] = [
  'bot_info', 'webhook_endpoint', 'webhook_test', 'webhook_silence',
];

export function parseConnectionIssues(raw: string | null): LineAccountConnectionIssue[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      kind: item.kind as LineAccountConnectionIssue['kind'],
      result: item.result as LineAccountConnectionIssue['result'],
      expectedUrl: typeof item.expectedUrl === 'string' ? item.expectedUrl : null,
      registeredUrl: typeof item.registeredUrl === 'string' ? item.registeredUrl : null,
      webhookActive: item.webhookActive == null ? null : Boolean(item.webhookActive),
      httpStatus: typeof item.httpStatus === 'number' ? item.httpStatus : null,
    }))
    .filter((item) => CONNECTION_ISSUE_ORDER.includes(item.kind))
    .sort((a, b) => CONNECTION_ISSUE_ORDER.indexOf(a.kind) - CONNECTION_ISSUE_ORDER.indexOf(b.kind));
}

/**
 * Returns the counters and persisted connection health used by the account
 * list in one D1 query.
 *
 * The JSON input keeps the bind count constant even when an operator has many
 * accounts. Each source is aggregated before UNION ALL so joins cannot
 * multiply another source's count.
 */
export async function getLineAccountListStats(
  db: D1Database,
  lineAccountIds: string[],
): Promise<Record<string, LineAccountListStats>> {
  if (lineAccountIds.length === 0) return {};

  const result = await db
    .prepare(
      `WITH requested_accounts(line_account_id) AS (
         SELECT CAST(value AS TEXT) FROM json_each(?)
       ), source_counts AS (
         SELECT f.line_account_id,
                COUNT(*) AS friend_count,
                0 AS active_scenarios,
                0 AS messages_this_month
           FROM friends f
           INNER JOIN requested_accounts requested
             ON requested.line_account_id = f.line_account_id
          WHERE f.is_following = 1
          GROUP BY f.line_account_id
         UNION ALL
         SELECT f.line_account_id,
                0 AS friend_count,
                COUNT(*) AS active_scenarios,
                0 AS messages_this_month
           FROM friend_scenarios fs
           INNER JOIN friends f ON f.id = fs.friend_id
           INNER JOIN requested_accounts requested
             ON requested.line_account_id = f.line_account_id
          WHERE fs.status = 'active'
          GROUP BY f.line_account_id
         UNION ALL
         SELECT f.line_account_id,
                0 AS friend_count,
                0 AS active_scenarios,
                COUNT(*) AS messages_this_month
           FROM messages_log ml
           INNER JOIN friends f ON f.id = ml.friend_id
           INNER JOIN requested_accounts requested
             ON requested.line_account_id = f.line_account_id
          WHERE ml.direction = 'outgoing'
            AND (ml.delivery_type IS NULL OR ml.delivery_type = 'push')
            AND ml.created_at >= date('now', 'start of month')
          GROUP BY f.line_account_id
       ), staff_assignments AS (
         SELECT requested.line_account_id, staff.id AS staff_id
           FROM requested_accounts requested
           INNER JOIN line_accounts account ON account.id = requested.line_account_id
           INNER JOIN staff_members staff
             ON staff.is_active = 1
            AND staff.invite_status = 'active'
            AND staff.account_scope = 'all'
            AND COALESCE(staff.tenant_id, '${DEFAULT_TENANT_ID}') =
                COALESCE(account.tenant_id, '${DEFAULT_TENANT_ID}')
         UNION
         SELECT requested.line_account_id, staff.id AS staff_id
           FROM requested_accounts requested
           INNER JOIN line_accounts account ON account.id = requested.line_account_id
           INNER JOIN staff_account_scopes scope
             ON scope.line_account_id = requested.line_account_id
           INNER JOIN staff_members staff
             ON staff.id = scope.staff_id
            AND staff.is_active = 1
            AND staff.invite_status = 'active'
            AND staff.account_scope = 'accounts'
            AND COALESCE(staff.tenant_id, '${DEFAULT_TENANT_ID}') =
                COALESCE(account.tenant_id, '${DEFAULT_TENANT_ID}')
       ), staff_counts AS (
         SELECT line_account_id, COUNT(*) AS staff_count
           FROM staff_assignments
          GROUP BY line_account_id
       ), connection_events AS (
         SELECT checks.* FROM line_account_connection_checks checks
           INNER JOIN requested_accounts requested ON requested.line_account_id = checks.line_account_id
          WHERE checks.check_kind IN ('bot_info', 'webhook_endpoint', 'webhook_test')
       ), latest_bot_health AS (
         SELECT health.* FROM requested_accounts requested
           INNER JOIN account_health_logs health ON health.id = (
             SELECT recent.id FROM account_health_logs recent
              WHERE recent.line_account_id = requested.line_account_id
              ORDER BY julianday(CASE WHEN substr(recent.created_at, -1) = 'Z'
                OR substr(recent.created_at, -6, 1) IN ('+', '-') THEN recent.created_at
                ELSE recent.created_at || '+09:00' END) DESC, recent.id DESC LIMIT 1
           )
       ), combined_checks AS (
         SELECT id, line_account_id, check_kind, result, checked_at,
                expected_url, registered_url, webhook_active, http_status FROM connection_events
         UNION ALL
         SELECT id, line_account_id, 'bot_info', CASE WHEN error_count > 0 OR error_code > 0 THEN 'failed' ELSE 'ok' END,
                created_at, NULL, NULL, NULL, CASE WHEN error_code > 0 THEN error_code ELSE NULL END
           FROM latest_bot_health
       ), normalized_checks AS (
         SELECT checks.*,
                strftime('%Y-%m-%dT%H:%M:%fZ', CASE
                  WHEN substr(checked_at, -1) = 'Z' OR substr(checked_at, -6, 1) IN ('+', '-') THEN checked_at
                  ELSE checked_at || '+09:00' END) AS checked_instant
           FROM combined_checks checks
       ), ranked_checks AS (
         SELECT checks.line_account_id, checks.check_kind, checks.result, checks.checked_instant AS checked_at,
                checks.expected_url, checks.registered_url, checks.webhook_active, checks.http_status,
                ROW_NUMBER() OVER (
                  PARTITION BY checks.line_account_id, checks.check_kind
                  ORDER BY checks.checked_instant DESC, checks.id DESC
                ) AS recency
           FROM normalized_checks checks
       ), connection_rollup AS (
         SELECT line_account_id,
                COUNT(*) AS check_count,
                MAX(CASE WHEN check_kind = 'bot_info' AND result IN ('ok', 'matched') THEN 1 ELSE 0 END) AS bot_confirmed,
                MAX(CASE WHEN check_kind = 'webhook_endpoint' AND result IN ('ok', 'matched') THEN 1 ELSE 0 END) AS webhook_confirmed,
                MAX(checked_at) AS checked_at,
                MAX(CASE WHEN result IN ('mismatched', 'unconfigured', 'failed') THEN 1 ELSE 0 END) AS has_warning,
                MAX(CASE WHEN result NOT IN ('matched', 'ok') THEN 1 ELSE 0 END) AS has_unconfirmed,
                json_group_array(
                  CASE WHEN result IN ('mismatched', 'unconfigured', 'failed') THEN json_object(
                    'kind', check_kind, 'result', result,
                    'expectedUrl', expected_url, 'registeredUrl', registered_url,
                    'webhookActive', webhook_active, 'httpStatus', http_status
                  ) END
                ) AS issues
           FROM ranked_checks
          WHERE recency = 1
          GROUP BY line_account_id
       )
       SELECT requested.line_account_id,
              COALESCE(SUM(source.friend_count), 0) AS friend_count,
              COALESCE(SUM(source.active_scenarios), 0) AS active_scenarios,
              COALESCE(SUM(source.messages_this_month), 0) AS messages_this_month,
              COALESCE(staff_counts.staff_count, 0) AS staff_count,
              account.is_active AS account_active,
              account.archived_at AS account_archived_at,
              connection.checked_at AS connection_checked_at,
              connection.issues AS connection_issues,
              account.token_expires_at, account.last_webhook_received_at,
              account.webhook_silence_exempt, account.created_at,
              CASE
                WHEN COALESCE(connection.has_warning, 0) = 1 THEN 'warn'
                WHEN COALESCE(connection.check_count, 0) = 0 THEN 'unknown'
                WHEN connection.bot_confirmed = 1 AND connection.webhook_confirmed = 1
                 AND COALESCE(connection.has_unconfirmed, 0) = 0 THEN 'ok'
                ELSE 'unknown'
              END AS connection_status
         FROM requested_accounts requested
         INNER JOIN line_accounts account ON account.id = requested.line_account_id
         LEFT JOIN source_counts source
           ON source.line_account_id = requested.line_account_id
         LEFT JOIN staff_counts
           ON staff_counts.line_account_id = requested.line_account_id
         LEFT JOIN connection_rollup connection
           ON connection.line_account_id = requested.line_account_id
        GROUP BY requested.line_account_id`,
    )
    .bind(JSON.stringify(lineAccountIds))
    .all<{
      line_account_id: string;
      friend_count: number;
      active_scenarios: number;
      messages_this_month: number;
      staff_count: number;
      account_active: number;
      account_archived_at: string | null;
      connection_status: 'ok' | 'warn' | 'unknown';
      connection_checked_at: string | null;
      connection_issues: string | null;
      token_expires_at: string | null;
      last_webhook_received_at: string | null;
      webhook_silence_exempt: number;
      created_at: string;
    }>();

  return Object.fromEntries(result.results.map((row) => {
    const silent = lineWebhookSilence({ lastReceivedAt: row.last_webhook_received_at, createdAt: row.created_at, exempt: Boolean(row.webhook_silence_exempt) });
    const issues = parseConnectionIssues(row.connection_issues);
    if (silent) issues.push({ kind: 'webhook_silence', result: 'failed', expectedUrl: null, registeredUrl: null, webhookActive: null, httpStatus: null });
    return [row.line_account_id, {
      friendCount: Number(row.friend_count),
      activeScenarios: Number(row.active_scenarios),
      messagesThisMonth: Number(row.messages_this_month),
      staffCount: Number(row.staff_count),
      connection: {
        status: silent ? 'warn' : row.connection_status,
        isActive: Boolean(row.account_active), archivedAt: row.account_archived_at,
        checkedAt: row.connection_checked_at,
        tokenExpired: lineTokenExpiry(row.token_expires_at).status === 'expired',
        issues,
      },
    }];
  }));
}
