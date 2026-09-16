import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  countActivePlatformAdmins,
  countImpersonationsSince,
  createPlatformAdmin,
  endImpersonation,
  getActiveImpersonation,
  getPlatformAdminByStaffId,
  getStaffById,
  listPlatformAdminMembers,
  listPlatformAudit,
  PLATFORM_AUDIT_ACTIONS,
  recordPlatformAudit,
  revealPiiForImpersonation,
  setPlatformAdminActive,
  startImpersonation,
  switchImpersonationToRead,
  switchImpersonationToWrite,
  type PlatformAuditAction,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requirePlatformAdmin, requirePlatformAdminWrite } from '../middleware/platform-admin.js';
import { toImpersonationContext } from '../middleware/impersonation.js';
import { clientIp } from '../services/admin-session.js';
import { dbFor } from '../services/db-router.js';

/**
 * 運営コンソール（★V6 37 マスター）の API。すべて運営マスターだけが呼べる。
 *
 * ここでは統括（tenants）をまたいで読む。tenantScopeMiddleware は LINE アカウント
 * の query しか見ないので、この下の各ルートで統括 ID を必ず検証する。
 */
export const ops = new Hono<Env>();

ops.use('/api/ops/*', requirePlatformAdmin());

type TenantStatus = 'active' | 'suspended' | 'archived';
const TENANT_STATUSES = new Set<TenantStatus>(['active', 'suspended', 'archived']);

type TenantListRow = {
  id: string;
  name: string;
  status: TenantStatus;
  feature_packs: string;
  plan_key: string | null;
  plan_status: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  created_at: string;
  updated_at: string;
  account_count: number;
  staff_count: number;
  last_login_at: string | null;
};

function reasonFrom(body: unknown): string | null {
  const reason = (body as { reason?: unknown } | null)?.reason;
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (trimmed.length < 4 || trimmed.length > 500) return null;
  return trimmed;
}

async function tenantById(c: Context<Env>, id: string) {
  return dbFor(c.env)
    .prepare(`SELECT id, name, status, feature_packs, plan_key, plan_status, trial_ends_at,
                     current_period_ends_at, created_at, updated_at
              FROM tenants WHERE id = ?`)
    .bind(id)
    .first<Omit<TenantListRow, 'account_count' | 'staff_count' | 'last_login_at'>>();
}

// ---------------------------------------------------------------------------
// 自分
// ---------------------------------------------------------------------------

ops.get('/api/ops/me', async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const admin = await getPlatformAdminByStaffId(db, staff.id);
  const row = await getStaffById(db, staff.id);
  const session = await getActiveImpersonation(db, staff.id);
  return c.json({
    success: true,
    data: {
      id: staff.id,
      name: staff.name,
      email: row?.email ?? null,
      readOnly: staff.readOnly,
      totpEnabled: Boolean(row?.totp_enabled_at),
      lineLinked: Boolean(row?.line_user_id),
      // platform_admins に無い＝互換判定で通っている。画面に注意を出す。
      legacy: !admin,
      impersonation: session ? toImpersonationContext(session) : null,
    },
  });
});

// ---------------------------------------------------------------------------
// 契約先アカウント（37-3 / 37-4）
// ---------------------------------------------------------------------------

ops.get('/api/ops/tenants', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const status = c.req.query('status');
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status && TENANT_STATUSES.has(status as TenantStatus)) { where.push('t.status = ?'); binds.push(status); }
  if (q) {
    where.push(`(t.name LIKE ? OR EXISTS (SELECT 1 FROM line_accounts la WHERE la.tenant_id = t.id AND la.name LIKE ?)
      OR EXISTS (SELECT 1 FROM staff_members sm WHERE sm.tenant_id = t.id AND (sm.email LIKE ? OR sm.name LIKE ?)))`);
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await dbFor(c.env)
    .prepare(
      `SELECT t.id, t.name, t.status, t.feature_packs, t.plan_key, t.plan_status, t.trial_ends_at,
              t.current_period_ends_at, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM line_accounts la WHERE la.tenant_id = t.id AND la.archived_at IS NULL) AS account_count,
              (SELECT COUNT(*) FROM staff_members sm WHERE sm.tenant_id = t.id AND sm.is_active = 1) AS staff_count,
              (SELECT MAX(l.created_at) FROM login_audit l JOIN staff_members s2 ON s2.id = l.admin_user_id
                 WHERE s2.tenant_id = t.id AND l.action = 'login') AS last_login_at
       FROM tenants t ${clause}
       ORDER BY t.created_at DESC, t.id ASC
       LIMIT 500`,
    )
    .bind(...binds)
    .all<TenantListRow>();
  const rows = results ?? [];
  const summary = {
    active: rows.filter((r) => r.status === 'active' && r.plan_status !== 'trialing').length,
    trialing: rows.filter((r) => r.plan_status === 'trialing').length,
    suspended: rows.filter((r) => r.status === 'suspended').length,
    pastDue: rows.filter((r) => r.plan_status === 'past_due').length,
  };
  return c.json({
    success: true,
    data: rows.map(({ feature_packs, ...row }) => ({ ...row, featurePacks: safeParse(feature_packs) })),
    summary,
  });
});

ops.get('/api/ops/tenants/:id', async (c) => {
  const db = dbFor(c.env);
  const tenant = await tenantById(c, c.req.param('id'));
  if (!tenant) return c.json({ success: false, error: '契約先が見つかりません' }, 404);
  const accounts = await db
    .prepare(
      `SELECT la.id, la.name, la.is_active, la.archived_at, la.updated_at,
              (SELECT COUNT(*) FROM friends f WHERE f.line_account_id = la.id) AS friend_count
       FROM line_accounts la WHERE la.tenant_id = ? ORDER BY la.created_at ASC`,
    )
    .bind(tenant.id)
    .all<{ id: string; name: string; is_active: number; archived_at: string | null; updated_at: string; friend_count: number }>();
  const members = await db
    .prepare(
      `SELECT sm.id, sm.name, sm.email, sm.role, sm.access_level, sm.is_active, sm.invite_status,
              (SELECT MAX(l.created_at) FROM login_audit l WHERE l.admin_user_id = sm.id AND l.action = 'login') AS last_login_at
       FROM staff_members sm WHERE sm.tenant_id = ? ORDER BY sm.created_at ASC`,
    )
    .bind(tenant.id)
    .all<{ id: string; name: string; email: string | null; role: string; access_level: string; is_active: number; invite_status: string; last_login_at: string | null }>();
  const audit = await listPlatformAudit(db, { tenantId: tenant.id, limit: 20 });
  const lastLogin = await db
    .prepare(`SELECT MAX(l.created_at) AS last_login_at FROM login_audit l JOIN staff_members s2 ON s2.id = l.admin_user_id
              WHERE s2.tenant_id = ? AND l.action = 'login'`)
    .bind(tenant.id)
    .first<{ last_login_at: string | null }>();
  const { feature_packs, ...rest } = tenant;
  return c.json({
    success: true,
    data: {
      tenant: { ...rest, featurePacks: safeParse(feature_packs), last_login_at: lastLogin?.last_login_at ?? null },
      accounts: accounts.results ?? [],
      members: members.results ?? [],
      audit: audit.rows,
    },
  });
});

ops.patch('/api/ops/tenants/:id/status', requirePlatformAdminWrite(), async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const tenant = await tenantById(c, c.req.param('id'));
  if (!tenant) return c.json({ success: false, error: '契約先が見つかりません' }, 404);
  const body = await c.req.json<{ status?: unknown; reason?: unknown; confirmName?: unknown }>().catch(() => null);
  const status = body?.status;
  if (typeof status !== 'string' || !TENANT_STATUSES.has(status as TenantStatus)) {
    return c.json({ success: false, error: '利用できない状態です' }, 400);
  }
  const reason = reasonFrom(body);
  if (!reason) return c.json({ success: false, error: '理由を4文字以上で入力してください' }, 400);
  // 停止・アーカイブは契約先の名前を手で入力させる（要件 §3 37-4）。
  if (status !== 'active' && body?.confirmName !== tenant.name) {
    return c.json({ success: false, error: '確認のため、契約先の名前をそのまま入力してください' }, 400);
  }
  await db
    .prepare(`UPDATE tenants SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE id = ?`)
    .bind(status, tenant.id)
    .run();
  await recordPlatformAudit(db, {
    staffId: staff.id,
    staffName: staff.name,
    tenantId: tenant.id,
    tenantName: tenant.name,
    action: 'tenant.status.change',
    reason,
    detail: { from: tenant.status, to: status },
    ip: clientIp(c),
    visibleToTenant: true,
  });
  return c.json({ success: true, data: { status } });
});

// ---------------------------------------------------------------------------
// 代理ログイン（37-5）
// ---------------------------------------------------------------------------

ops.get('/api/ops/impersonation/current', async (c) => {
  const staff = c.get('staff');
  const session = await getActiveImpersonation(dbFor(c.env), staff.id);
  if (!session) return c.json({ success: true, data: null });
  const tenant = await tenantById(c, session.tenant_id);
  return c.json({
    success: true,
    data: { ...toImpersonationContext(session), tenantName: tenant?.name ?? null },
  });
});

ops.post('/api/ops/impersonation/start', requirePlatformAdminWrite(), async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const body = await c.req.json<{ tenantId?: unknown }>().catch(() => null);
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : '';
  const tenant = tenantId ? await tenantById(c, tenantId) : null;
  if (!tenant) return c.json({ success: false, error: '契約先が見つかりません' }, 404);
  if (tenant.status === 'archived') {
    return c.json({ success: false, error: 'アーカイブ済みの契約先には入れません' }, 400);
  }
  const session = await startImpersonation(db, { staffId: staff.id, tenantId: tenant.id });
  // 閲覧だけの代理ログインは契約先には見せない（要件 §3 37-5）。運営側の記録にだけ残す。
  await recordPlatformAudit(db, {
    staffId: staff.id,
    staffName: staff.name,
    tenantId: tenant.id,
    tenantName: tenant.name,
    action: 'impersonation.start',
    detail: { sessionId: session.id },
    ip: clientIp(c),
    visibleToTenant: false,
  });
  return c.json({ success: true, data: { ...toImpersonationContext(session), tenantName: tenant.name } });
});

ops.post('/api/ops/impersonation/write', requirePlatformAdminWrite(), async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const session = await getActiveImpersonation(db, staff.id);
  if (!session) return c.json({ success: false, error: '代理ログイン中ではありません' }, 400);
  const body = await c.req.json().catch(() => null);
  const reason = reasonFrom(body);
  if (!reason) return c.json({ success: false, error: '理由を4文字以上で入力してください' }, 400);
  await switchImpersonationToWrite(db, session.id, reason);
  const tenant = await tenantById(c, session.tenant_id);
  // 書き込みに切り替えたら、契約先の画面にも履歴を残す（要件 §3 37-5）。
  await recordPlatformAudit(db, {
    staffId: staff.id,
    staffName: staff.name,
    tenantId: session.tenant_id,
    tenantName: tenant?.name ?? null,
    action: 'impersonation.write',
    reason,
    detail: { sessionId: session.id },
    ip: clientIp(c),
    visibleToTenant: true,
  });
  return c.json({ success: true, data: { ...toImpersonationContext({ ...session, mode: 'write', write_reason: reason }), tenantName: tenant?.name ?? null } });
});

ops.post('/api/ops/impersonation/read', requirePlatformAdminWrite(), async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const session = await getActiveImpersonation(db, staff.id);
  if (!session) return c.json({ success: false, error: '代理ログイン中ではありません' }, 400);
  await switchImpersonationToRead(db, session.id);
  return c.json({ success: true, data: toImpersonationContext({ ...session, mode: 'read' }) });
});

ops.post('/api/ops/impersonation/pii-reveal', requirePlatformAdminWrite(), async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const session = await getActiveImpersonation(db, staff.id);
  if (!session) return c.json({ success: false, error: '代理ログイン中ではありません' }, 400);
  const body = await c.req.json().catch(() => null);
  const reason = reasonFrom(body);
  if (!reason) return c.json({ success: false, error: '理由を4文字以上で入力してください' }, 400);
  await revealPiiForImpersonation(db, {
    impersonationSessionId: session.id,
    staffId: staff.id,
    tenantId: session.tenant_id,
    reason,
  });
  const tenant = await tenantById(c, session.tenant_id);
  await recordPlatformAudit(db, {
    staffId: staff.id,
    staffName: staff.name,
    tenantId: session.tenant_id,
    tenantName: tenant?.name ?? null,
    action: 'pii.reveal',
    reason,
    detail: { sessionId: session.id },
    ip: clientIp(c),
    visibleToTenant: false,
  });
  return c.json({ success: true, data: toImpersonationContext({ ...session, pii_revealed: 1 }) });
});

ops.post('/api/ops/impersonation/end', requirePlatformAdminWrite(), async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const session = await getActiveImpersonation(db, staff.id);
  if (!session) return c.json({ success: true, data: null });
  await endImpersonation(db, session.id);
  const tenant = await tenantById(c, session.tenant_id);
  await recordPlatformAudit(db, {
    staffId: staff.id,
    staffName: staff.name,
    tenantId: session.tenant_id,
    tenantName: tenant?.name ?? null,
    action: 'impersonation.end',
    detail: { sessionId: session.id, mode: session.mode },
    ip: clientIp(c),
    visibleToTenant: false,
  });
  return c.json({ success: true, data: null });
});

// ---------------------------------------------------------------------------
// 監査ログ（37-8）
// ---------------------------------------------------------------------------

ops.get('/api/ops/audit', async (c) => {
  const actionsRaw = (c.req.query('action') ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  const actions = actionsRaw.filter((a): a is PlatformAuditAction =>
    (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(a));
  const limit = Number.parseInt(c.req.query('limit') ?? '50', 10) || 50;
  const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
  const result = await listPlatformAudit(dbFor(c.env), {
    tenantId: c.req.query('tenant_id') || null,
    actions,
    from: c.req.query('from') || null,
    to: c.req.query('to') || null,
    limit,
    offset,
  });
  return c.json({ success: true, data: result.rows, total: result.total });
});

// ---------------------------------------------------------------------------
// 運営メンバー（37-10）
// ---------------------------------------------------------------------------

ops.get('/api/ops/members', async (c) => {
  const db = dbFor(c.env);
  const members = await listPlatformAdminMembers(db);
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const monthly = await countImpersonationsSince(db, since.toISOString().slice(0, 10));
  return c.json({
    success: true,
    data: members.map((m) => ({
      staffId: m.staff_id,
      name: m.name,
      email: m.email,
      isActive: m.is_active === 1 && m.staff_is_active === 1,
      totpEnabled: Boolean(m.totp_enabled_at),
      lineLinked: Boolean(m.line_user_id),
      inviteStatus: m.invite_status,
      approvedBy: m.approved_by,
      lastLoginAt: m.last_login_at,
      createdAt: m.created_at,
    })),
    summary: {
      members: members.filter((m) => m.is_active === 1).length,
      totpEnabled: members.filter((m) => m.is_active === 1 && m.totp_enabled_at).length,
      impersonationsThisMonth: monthly.total,
      writeImpersonationsThisMonth: monthly.write,
      piiRevealsThisMonth: monthly.piiReveals,
    },
  });
});

/**
 * 既存の staff_members を運営マスターに加える。
 * 自分自身は加えられない（ほかの運営メンバーの承認、要件 §3 37-10）。
 *
 * 例外は最初の 1 人だけ。platform_admins が空の間は互換判定（既定の統括の
 * オーナー）で入っているので、その人が自分を登録して初期化する（要件 §6-2
 * 「登録 → 確認 → 旧判定を外す」）。1 人でも登録されたあとは通常どおり。
 */
ops.post('/api/ops/members', requirePlatformAdminWrite(), async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const body = await c.req.json<{ staffId?: unknown; email?: unknown }>().catch(() => null);
  let target = typeof body?.staffId === 'string' ? await getStaffById(db, body.staffId) : null;
  if (!target && typeof body?.email === 'string' && body.email.trim()) {
    target = await db
      .prepare('SELECT * FROM staff_members WHERE lower(email) = lower(?) AND is_active = 1 LIMIT 1')
      .bind(body.email.trim())
      .first();
  }
  if (!target) return c.json({ success: false, error: '対象の権限者が見つかりません' }, 404);
  if (target.id === staff.id && (await countActivePlatformAdmins(db)) > 0) {
    return c.json({ success: false, error: '自分自身を運営メンバーに加えることはできません。ほかの運営メンバーに依頼してください' }, 400);
  }
  await createPlatformAdmin(db, { staffId: target.id, approvedBy: target.id === staff.id ? null : staff.id });
  await recordPlatformAudit(db, {
    staffId: staff.id,
    staffName: staff.name,
    action: 'member.invite',
    detail: { targetStaffId: target.id, targetName: target.name },
    ip: clientIp(c),
    visibleToTenant: false,
  });
  return c.json({ success: true, data: { staffId: target.id } }, 201);
});

ops.patch('/api/ops/members/:staffId', requirePlatformAdminWrite(), async (c) => {
  const staff = c.get('staff');
  const db = dbFor(c.env);
  const targetId = c.req.param('staffId');
  const body = await c.req.json<{ isActive?: unknown }>().catch(() => null);
  if (typeof body?.isActive !== 'boolean') return c.json({ success: false, error: 'isActive を指定してください' }, 400);
  if (targetId === staff.id) return c.json({ success: false, error: '自分自身の運営権限は変えられません' }, 400);
  if (!body.isActive) {
    const active = await countActivePlatformAdmins(db);
    if (active <= 1) return c.json({ success: false, error: '最後の運営メンバーは停止できません' }, 400);
  }
  const target = await getStaffById(db, targetId);
  if (!target) return c.json({ success: false, error: '対象の権限者が見つかりません' }, 404);
  await setPlatformAdminActive(db, targetId, body.isActive);
  await recordPlatformAudit(db, {
    staffId: staff.id,
    staffName: staff.name,
    action: body.isActive ? 'member.activate' : 'member.deactivate',
    detail: { targetStaffId: targetId, targetName: target.name },
    ip: clientIp(c),
    visibleToTenant: false,
  });
  return c.json({ success: true, data: { staffId: targetId, isActive: body.isActive } });
});

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return []; }
}

// ---------------------------------------------------------------------------
// 契約先（統括）から見える運営の操作履歴。書き込みを伴ったものだけ。
// /api/ops/* の門番は掛からない（統括の権限者が呼ぶ）。
// ---------------------------------------------------------------------------

ops.get('/api/hq/operator-history', async (c) => {
  const staff = c.get('staff');
  if (!staff.tenantId) return c.json({ success: true, data: [] });
  const result = await listPlatformAudit(dbFor(c.env), {
    tenantId: staff.tenantId,
    visibleOnly: true,
    limit: 50,
  });
  return c.json({
    success: true,
    data: result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      operatorName: row.staff_name,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  });
});
