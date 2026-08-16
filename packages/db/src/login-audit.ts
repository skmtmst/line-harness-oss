import { jstNow } from './utils.js';

/**
 * ログインと個人情報閲覧の記録。
 *
 * 個人情報保護法上、誰がいつ個人情報を見たかを残す必要がある。
 * ログインの成否だけでなく、is_personal の項目を開いたことも残す。
 */

export const LOGIN_AUDIT_ACTIONS = [
  'login',
  'logout',
  'fail',
  'view_personal',
  'export',
] as const;
export type LoginAuditAction = (typeof LOGIN_AUDIT_ACTIONS)[number];

export interface LoginAuditRow {
  id: string;
  admin_user_id: string | null;
  action: string;
  screen: string | null;
  ip: string | null;
  user_agent: string | null;
  result: string;
  created_at: string;
}

/**
 * 記録を残す。
 *
 * 例外を投げない。記録に失敗したせいでログインそのものが失敗する、
 * という向きの事故を作らないため。失敗はログに出す。
 */
export async function recordLoginAudit(
  db: D1Database,
  input: {
    adminUserId?: string | null;
    action: LoginAuditAction;
    screen?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    result?: string;
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO login_audit
           (id, admin_user_id, action, screen, ip, user_agent, result, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.adminUserId ?? null,
        input.action,
        input.screen ?? null,
        input.ip ?? null,
        // User-Agent は長い。切っておかないと1行が肥大する。
        input.userAgent ? input.userAgent.slice(0, 300) : null,
        input.result ?? 'ok',
        jstNow(),
      )
      .run();
  } catch (error) {
    console.error('login_audit insert failed:', error);
  }
}

export async function getLoginAudit(
  db: D1Database,
  opts: { adminUserId?: string; action?: LoginAuditAction; limit?: number } = {},
): Promise<LoginAuditRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (opts.adminUserId) {
    conditions.push('admin_user_id = ?');
    values.push(opts.adminUserId);
  }
  if (opts.action) {
    conditions.push('action = ?');
    values.push(opts.action);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(Math.min(opts.limit ?? 100, 500));
  const result = await db
    .prepare(`SELECT * FROM login_audit ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values)
    .all<LoginAuditRow>();
  return result.results;
}
