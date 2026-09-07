import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { jstNow } from './utils.js';

export type AccessUserStatus = 'active' | 'invited' | 'expired' | 'suspended';
export type AccessRoleBundle = 'administrator' | 'operations' | 'reception' | 'view_only' | 'custom';
export type AuditCategory = 'auth' | 'business';
export type AuditResult = 'success' | 'denied' | 'failed';
export type AuditRiskLevel = 'normal' | 'suspicious' | 'high';
export type AuditRetentionClass = 'general' | 'security' | 'personal_data';

type StaffAccessRow = {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
  access_level: 'full' | 'read_only';
  is_active: number;
  permission_keys: string;
  invite_status: string;
  invite_expires_at: string | null;
  totp_enabled_at: string | null;
  totp_secret_enc: string | null;
  assigned_line_account_id: string | null;
  can_access_descendant_accounts: number;
  account_scope: 'all' | 'accounts';
  scoped_line_account_ids: string | null;
  policy_version: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  last_action_at: string | null;
};

export type AccessUserItem = {
  id: string;
  name: string;
  email: string | null;
  jobTitle: null;
  roleBundle: AccessRoleBundle;
  featureCount: number | null;
  hasFieldMasks: null;
  accountScope: {
    type: 'all' | 'accounts';
    assignedLineAccountId: string | null;
    lineAccountIds: string[];
    includesDescendants: boolean;
  };
  lastLoginAt: string | null;
  lastActionAt: string | null;
  mfaEnabled: boolean;
  status: AccessUserStatus;
  policyVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type AccessUserSummary = {
  active: number;
  invited: number;
  expiredInvitations: number;
  unused90Days: number;
  mfaEnabled: number;
  mfaRate: number | null;
  roleCounts: Record<AccessRoleBundle, number>;
};

export type ListAccessUsersInput = {
  tenantId?: string | null;
  allowedLineAccountIds: string[];
  lineAccountId?: string;
  status?: AccessUserStatus;
  roleBundle?: AccessRoleBundle;
  query?: string;
  includeEmailInSearch?: boolean;
  limit?: number;
  offset?: number;
  now?: string;
};

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parsePermissionKeys(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function roleBundleFor(row: Pick<StaffAccessRow, 'role' | 'access_level'>): AccessRoleBundle {
  if (row.access_level === 'read_only') return 'view_only';
  if (row.role === 'owner' || row.role === 'admin') return 'administrator';
  return 'operations';
}

function statusFor(row: Pick<StaffAccessRow, 'is_active' | 'invite_status' | 'invite_expires_at'>, now: string): AccessUserStatus {
  if (row.invite_status === 'pending_email' || row.invite_status === 'pending_line') {
    if (row.invite_expires_at && Date.parse(row.invite_expires_at) <= Date.parse(now)) return 'expired';
    return 'invited';
  }
  return row.is_active ? 'active' : 'suspended';
}

function canSeeRowInAccountScope(
  row: StaffAccessRow,
  visibleIds: ReadonlySet<string>,
  requestedLineAccountId?: string,
): boolean {
  if (row.account_scope === 'all') return true;
  const rowIds = new Set(parseStringArray(row.scoped_line_account_ids));
  if (row.assigned_line_account_id) rowIds.add(row.assigned_line_account_id);
  if (requestedLineAccountId) return rowIds.has(requestedLineAccountId);
  for (const id of rowIds) if (visibleIds.has(id)) return true;
  return false;
}

function emptyRoleCounts(): Record<AccessRoleBundle, number> {
  return { administrator: 0, operations: 0, reception: 0, view_only: 0, custom: 0 };
}

function accessUserItem(row: StaffAccessRow, now: string): AccessUserItem {
  const scopedLineAccountIds = parseStringArray(row.scoped_line_account_ids);
  const permissionKeys = parsePermissionKeys(row.permission_keys);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    jobTitle: null,
    roleBundle: roleBundleFor(row),
    featureCount: row.role === 'owner' || row.role === 'admin' ? null : permissionKeys.length,
    // 現行DBに項目maskの構造化列はない。推測でfalseにせず、未取得をnullで返す。
    hasFieldMasks: null,
    accountScope: {
      type: row.account_scope ?? 'all',
      assignedLineAccountId: row.assigned_line_account_id ?? null,
      lineAccountIds: row.account_scope === 'accounts' ? scopedLineAccountIds : [],
      includesDescendants: Boolean(row.can_access_descendant_accounts),
    },
    lastLoginAt: row.last_login_at,
    lastActionAt: row.last_action_at,
    mfaEnabled: Boolean(row.totp_enabled_at && row.totp_secret_enc),
    status: statusFor(row, now),
    policyVersion: Number(row.policy_version ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAccessUsers(db: D1Database, input: ListAccessUsersInput): Promise<{
  items: AccessUserItem[];
  summary: AccessUserSummary;
  total: number;
  limit: number;
  offset: number;
}> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const now = input.now ?? new Date().toISOString();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const result = await db.prepare(
    `SELECT sm.id, sm.name, sm.email, sm.role, sm.access_level, sm.is_active,
            sm.permission_keys, sm.invite_status, sm.invite_expires_at,
            sm.totp_enabled_at, sm.totp_secret_enc, sm.assigned_line_account_id,
            sm.can_access_descendant_accounts, sm.account_scope, sm.policy_version,
            sm.created_at, sm.updated_at,
            (SELECT GROUP_CONCAT(sas.line_account_id)
               FROM staff_account_scopes sas WHERE sas.staff_id = sm.id) AS scoped_line_account_ids,
            (SELECT MAX(la.created_at) FROM login_audit la
              WHERE la.admin_user_id = sm.id AND la.action = 'login'
                AND lower(la.result) IN ('ok', 'success')) AS last_login_at,
            (SELECT MAX(ae.created_at) FROM audit_events ae
              WHERE ae.actor_principal_id = sm.id AND ae.category = 'business'
                AND ae.result = 'success') AS last_action_at
       FROM staff_members sm
      WHERE COALESCE(sm.tenant_id, ?) = ?
      ORDER BY COALESCE(last_login_at, '') DESC, sm.created_at ASC`,
  ).bind(DEFAULT_TENANT_ID, tenantId).all<StaffAccessRow>();

  const visibleIds = new Set(input.allowedLineAccountIds);
  const visibleRows = result.results.filter((row) =>
    canSeeRowInAccountScope(row, visibleIds, input.lineAccountId));
  const allItems = visibleRows.map((row) => accessUserItem(row, now));
  const roleCounts = emptyRoleCounts();
  for (const item of allItems) roleCounts[item.roleBundle] += 1;
  const activeItems = allItems.filter((item) => item.status === 'active');
  const cutoff90Days = Date.parse(now) - 90 * 24 * 60 * 60 * 1000;
  const mfaEnabled = activeItems.filter((item) => item.mfaEnabled).length;
  const summary: AccessUserSummary = {
    active: activeItems.length,
    invited: allItems.filter((item) => item.status === 'invited').length,
    expiredInvitations: allItems.filter((item) => item.status === 'expired').length,
    unused90Days: activeItems.filter((item) =>
      item.lastLoginAt !== null && Date.parse(item.lastLoginAt) < cutoff90Days).length,
    mfaEnabled,
    mfaRate: activeItems.length === 0 ? null : Math.round((mfaEnabled / activeItems.length) * 1000) / 10,
    roleCounts,
  };

  const normalizedQuery = input.query?.trim().toLocaleLowerCase('ja-JP') ?? '';
  const filtered = allItems.filter((item) => {
    if (input.status && item.status !== input.status) return false;
    if (input.roleBundle && item.roleBundle !== input.roleBundle) return false;
    if (!normalizedQuery) return true;
    const values = [item.name, item.jobTitle, item.roleBundle];
    if (input.includeEmailInSearch) values.push(item.email);
    return values.some((value) => value?.toLocaleLowerCase('ja-JP').includes(normalizedQuery));
  });

  return {
    items: filtered.slice(offset, offset + limit),
    summary,
    total: filtered.length,
    limit,
    offset,
  };
}

export const ACCESS_ROLE_BUNDLES: ReadonlyArray<{
  id: AccessRoleBundle;
  name: string;
  description: string;
  featureAccess: 'edit' | 'view' | 'custom';
  requiresMfa: boolean;
}> = [
  { id: 'administrator', name: '管理者', description: '全機能と権限・監査を管理', featureAccess: 'edit', requiresMfa: true },
  { id: 'operations', name: '運用', description: '配信・予約・コンテンツを運用', featureAccess: 'edit', requiresMfa: false },
  { id: 'reception', name: '受付', description: '受信箱・友だち・予約を担当', featureAccess: 'edit', requiresMfa: false },
  { id: 'view_only', name: '見るだけ', description: '選択した機能を閲覧', featureAccess: 'view', requiresMfa: false },
  { id: 'custom', name: 'カスタム', description: '機能ごとに個別設定', featureAccess: 'custom', requiresMfa: false },
];

export type RecordAuditEventInput = {
  id?: string;
  sourceKind?: string | null;
  sourceId?: string | null;
  tenantId?: string | null;
  lineAccountId?: string | null;
  category: AuditCategory;
  actorPrincipalId?: string | null;
  actorRole?: string | null;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  result?: AuditResult;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  requestTraceId?: string | null;
  ipPrefix?: string | null;
  deviceFamily?: string | null;
  riskLevel?: AuditRiskLevel;
  retentionClass?: AuditRetentionClass;
  createdAt?: string;
};

const SENSITIVE_KEY = /(secret|token|password|payload|body|message|content|email|phone|address|customer|friend.?name|raw)/i;

function safeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[省略]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 200);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeAuditValue(item, depth + 1));
  if (typeof value !== 'object') return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = safeAuditValue(item, depth + 1);
  }
  return result;
}

function safeAuditJson(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;
  return JSON.stringify(safeAuditValue(value));
}

function safeText(value: string | null | undefined, max: number): string | null {
  return value ? value.slice(0, max) : null;
}

export async function recordAuditEvent(db: D1Database, input: RecordAuditEventInput): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_events
       (id, source_kind, source_id, tenant_id, line_account_id, category,
        actor_principal_id, actor_role, action, target_kind, target_id, result,
        before_json, after_json, reason, request_trace_id, ip_prefix, device_family,
        risk_level, retention_class, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id ?? crypto.randomUUID(),
    safeText(input.sourceKind, 80),
    safeText(input.sourceId, 160),
    input.tenantId ?? DEFAULT_TENANT_ID,
    safeText(input.lineAccountId, 160),
    input.category,
    safeText(input.actorPrincipalId, 160),
    safeText(input.actorRole, 80),
    input.action.slice(0, 200),
    safeText(input.targetKind, 100),
    safeText(input.targetId, 200),
    input.result ?? 'success',
    safeAuditJson(input.before),
    safeAuditJson(input.after),
    safeText(input.reason, 300),
    safeText(input.requestTraceId, 160),
    safeText(input.ipPrefix, 80),
    safeText(input.deviceFamily, 80),
    input.riskLevel ?? 'normal',
    input.retentionClass ?? (input.category === 'auth' ? 'security' : 'general'),
    input.createdAt ?? jstNow(),
  ).run();
}

export function maskAuditIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:***`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.***` : null;
}

export function auditDeviceFamily(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|android|mobile/.test(ua)) return 'mobile';
  if (/windows/.test(ua)) return 'windows';
  if (/macintosh|mac os/.test(ua)) return 'mac';
  if (/linux/.test(ua)) return 'linux';
  return 'other';
}

type AuditEventRow = {
  id: string;
  category: AuditCategory;
  line_account_id: string | null;
  actor_principal_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  result: AuditResult;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  request_trace_id: string | null;
  ip_prefix: string | null;
  device_family: string | null;
  risk_level: AuditRiskLevel;
  retention_class: AuditRetentionClass;
  created_at: string;
};

export type ListAuditEventsInput = {
  tenantId?: string | null;
  allowedLineAccountIds: string[];
  lineAccountId?: string;
  category?: AuditCategory;
  result?: AuditResult;
  actorId?: string;
  action?: string;
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  now?: string;
};

function parseAuditJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function auditScopeSql(input: ListAuditEventsInput): { conditions: string[]; values: unknown[] } {
  const conditions = ['ae.tenant_id = ?'];
  const values: unknown[] = [input.tenantId ?? DEFAULT_TENANT_ID];
  if (input.lineAccountId) {
    conditions.push('ae.line_account_id = ?');
    values.push(input.lineAccountId);
  } else if (input.allowedLineAccountIds.length > 0) {
    conditions.push(`(ae.line_account_id IS NULL OR ae.line_account_id IN (${input.allowedLineAccountIds.map(() => '?').join(', ')}))`);
    values.push(...input.allowedLineAccountIds);
  } else {
    conditions.push('ae.line_account_id IS NULL');
  }
  return { conditions, values };
}

export async function listAuditEvents(db: D1Database, input: ListAuditEventsInput) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const scoped = auditScopeSql(input);
  const conditions = [...scoped.conditions];
  const values = [...scoped.values];
  if (input.category) { conditions.push('ae.category = ?'); values.push(input.category); }
  if (input.result) { conditions.push('ae.result = ?'); values.push(input.result); }
  if (input.actorId) { conditions.push('ae.actor_principal_id = ?'); values.push(input.actorId); }
  if (input.action) { conditions.push('ae.action LIKE ?'); values.push(`%${input.action}%`); }
  if (input.from) { conditions.push('ae.created_at >= ?'); values.push(input.from); }
  if (input.to) { conditions.push('ae.created_at <= ?'); values.push(input.to); }
  if (input.query?.trim()) {
    const query = `%${input.query.trim()}%`;
    conditions.push(`(ae.action LIKE ? OR COALESCE(sm.name, '') LIKE ?
      OR COALESCE(ae.target_kind, '') LIKE ? OR COALESCE(ae.target_id, '') LIKE ?)`);
    values.push(query, query, query, query);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const totalRow = await db.prepare(
    `SELECT COUNT(*) AS count FROM audit_events ae
      LEFT JOIN staff_members sm ON sm.id = ae.actor_principal_id ${where}`,
  ).bind(...values).first<{ count: number }>();
  const rows = await db.prepare(
    `SELECT ae.*, sm.name AS actor_name
       FROM audit_events ae
       LEFT JOIN staff_members sm ON sm.id = ae.actor_principal_id
       ${where}
      ORDER BY ae.created_at DESC, ae.id DESC LIMIT ? OFFSET ?`,
  ).bind(...values, limit, offset).all<AuditEventRow>();

  const summaryScope = auditScopeSql(input);
  const cutoff = new Date(Date.parse(input.now ?? new Date().toISOString()) - 30 * 24 * 60 * 60 * 1000).toISOString();
  const summary = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN lower(action) LIKE '%delete%' OR lower(action) LIKE 'api.delete.%' THEN 1 ELSE 0 END) AS deleted,
            SUM(CASE WHEN lower(action) LIKE '%send%' OR lower(action) LIKE '%publish%' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN category = 'business'
                      AND (lower(action) LIKE '%update%' OR lower(action) LIKE '%change%'
                        OR lower(action) LIKE 'api.patch.%' OR lower(action) LIKE 'api.put.%') THEN 1 ELSE 0 END) AS changed,
            SUM(CASE WHEN category = 'auth' AND action = 'auth.login' AND result = 'success' THEN 1 ELSE 0 END) AS logins,
            SUM(CASE WHEN category = 'auth' AND (risk_level <> 'normal' OR result <> 'success') THEN 1 ELSE 0 END) AS suspicious_logins
       FROM audit_events ae
      WHERE ${summaryScope.conditions.join(' AND ')} AND ae.created_at >= ?`,
  ).bind(...summaryScope.values, cutoff).first<{
    total: number; deleted: number; sent: number; changed: number; logins: number; suspicious_logins: number;
  }>();

  return {
    items: rows.results.map((row) => ({
      id: row.id,
      category: row.category,
      lineAccountId: row.line_account_id,
      actor: { id: row.actor_principal_id, name: row.actor_name, role: row.actor_role },
      action: row.action,
      target: row.target_kind || row.target_id ? { kind: row.target_kind, id: row.target_id } : null,
      result: row.result,
      before: parseAuditJson(row.before_json),
      after: parseAuditJson(row.after_json),
      reason: row.reason,
      requestTraceId: row.request_trace_id,
      ipPrefix: row.ip_prefix,
      deviceFamily: row.device_family,
      riskLevel: row.risk_level,
      retentionClass: row.retention_class,
      createdAt: row.created_at,
    })),
    summary: {
      periodDays: 30,
      total: Number(summary?.total ?? 0),
      deleted: Number(summary?.deleted ?? 0),
      sent: Number(summary?.sent ?? 0),
      changed: Number(summary?.changed ?? 0),
      logins: Number(summary?.logins ?? 0),
      suspiciousLogins: Number(summary?.suspicious_logins ?? 0),
    },
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  };
}
