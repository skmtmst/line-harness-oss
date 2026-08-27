import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  OPERATION_CAPABILITIES,
  getFriendById,
  getOperationControlSet,
  getLatestOperationHealthSnapshot,
  acknowledgeOperationHealthAlert,
  listOperationHealthAlerts,
  getOperationIncident,
  getPendingReminderDeliveries,
  listOperationIncidents,
  operationScopeKey,
  restoreOperationIncident,
  stopOperationCapabilities,
  type OperationCapability,
} from '@line-crm/db';
import { resolveReminderSendAt } from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import {
  finalizeOperationIdempotency,
  hashOperationRequest,
  isValidOperationIdempotencyKey,
  reserveOperationIdempotency,
} from '../services/operation-idempotency.js';
import { runOperationHealthChecks } from '../services/operation-health.js';

const operations = new Hono<Env>();

function requestedAccountId(value: string | undefined): string | null {
  return !value || value === 'all' ? null : value;
}

async function canUseScope(c: Context<Env>, accountId: string | null) {
  if (accountId === null) return c.get('staff')?.role === 'owner';
  return canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]);
}

function parseCapabilities(raw: unknown): OperationCapability[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const values = raw.filter((value): value is OperationCapability =>
    typeof value === 'string' && OPERATION_CAPABILITIES.includes(value as OperationCapability));
  if (values.length !== raw.length || new Set(values).size !== values.length) return null;
  return values;
}

async function countActive(
  db: D1Database,
  table: 'broadcasts' | 'scenarios' | 'reminders' | 'automations',
  activeSql: string,
  accountId: string | null,
): Promise<number> {
  const accountClause = accountId ? ' AND line_account_id = ?' : '';
  const statement = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${activeSql}${accountClause}`);
  const row = accountId
    ? await statement.bind(accountId).first<{ count: number }>()
    : await statement.first<{ count: number }>();
  return Number(row?.count ?? 0);
}

type RestoreBlockers = Partial<Record<OperationCapability, number>>;

async function countRestoreBlockers(
  db: D1Database,
  incident: Awaited<ReturnType<typeof getOperationIncident>> & {},
): Promise<RestoreBlockers> {
  // preview直後に期限へ達するraceも避けるため、5分以内を安全側で止める。
  const cutoff = new Date(Date.now() + 5 * 60_000).toISOString();
  const accountClause = incident.lineAccountId ? ' AND line_account_id = ?' : '';
  const count = async (sql: string) => {
    const statement = db.prepare(sql);
    const row = incident.lineAccountId
      ? await statement.bind(cutoff, incident.lineAccountId).first<{ count: number }>()
      : await statement.bind(cutoff).first<{ count: number }>();
    return Number(row?.count ?? 0);
  };
  const blockers: RestoreBlockers = {};
  if (incident.capabilities.includes('broadcast_dispatch')) {
    blockers.broadcast_dispatch = await count(
      `SELECT COUNT(*) AS count FROM broadcasts
        WHERE (status IN ('sending', 'queued') OR (status = 'scheduled' AND scheduled_at <= ?))${accountClause}`,
    );
  }
  if (incident.capabilities.includes('scenario_dispatch')) {
    const scope = incident.lineAccountId ? ' AND s.line_account_id = ?' : '';
    const statement = db.prepare(
      `SELECT COUNT(*) AS count FROM friend_scenarios fs
         JOIN scenarios s ON s.id = fs.scenario_id
        WHERE fs.status IN ('active', 'delivering') AND fs.next_delivery_at <= ?${scope}`,
    );
    const row = incident.lineAccountId
      ? await statement.bind(cutoff, incident.lineAccountId).first<{ count: number }>()
      : await statement.bind(cutoff).first<{ count: number }>();
    blockers.scenario_dispatch = Number(row?.count ?? 0);
  }
  if (incident.capabilities.includes('automation_actions')) {
    const scope = incident.lineAccountId ? ' AND line_account_id = ?' : '';
    const statement = db.prepare(
      `SELECT COUNT(*) AS count FROM automation_runs
        WHERE (status = 'queued' OR (status = 'waiting' AND resume_at <= ?)
          OR (status = 'running' AND lease_expires_at <= ?))${scope}`,
    );
    const row = incident.lineAccountId
      ? await statement.bind(cutoff, cutoff, incident.lineAccountId).first<{ count: number }>()
      : await statement.bind(cutoff, cutoff).first<{ count: number }>();
    blockers.automation_actions = Number(row?.count ?? 0);
  }
  if (incident.capabilities.includes('reminder_dispatch')) {
    let due = 0;
    const pending = await getPendingReminderDeliveries(db);
    const cutoffMs = Date.parse(cutoff);
    for (const reminder of pending) {
      const friend = await getFriendById(db, reminder.friend_id);
      const friendAccountId = (friend as unknown as Record<string, unknown> | null)?.line_account_id;
      if (incident.lineAccountId && friendAccountId !== incident.lineAccountId) continue;
      for (const step of reminder.steps) {
        const sendAt = resolveReminderSendAt(
          new Date(reminder.target_date),
          { offsetDays: step.offset_days, sendAtTime: step.send_at_time, offsetMinutes: step.offset_minutes },
          reminder.delivery_mode === 'time' ? 'time' : 'countdown',
        );
        if (sendAt.getTime() <= cutoffMs) due += 1;
      }
    }
    blockers.reminder_dispatch = due;
  }
  return blockers;
}

function hasRestoreBlockers(blockers: RestoreBlockers): boolean {
  return Object.values(blockers).some((count) => Number(count) > 0);
}

function replayJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'Idempotency-Replayed': 'true' },
  });
}

operations.get('/api/operations/control', async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  // 全体停止は全員が見えないと、別端末で通常運用と誤認する。
  // アカウント別状態だけ所属範囲を検査する。
  if (accountId !== null && !await canUseScope(c, accountId)) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  return c.json({ success: true, data: await getOperationControlSet(c.env.DB, accountId) });
});

operations.get('/api/operations/health', requireRole('owner', 'admin'), async (c) => {
  const snapshot = await getLatestOperationHealthSnapshot(c.env.DB);
  if (!snapshot) {
    return c.json({ success: true, data: null });
  }
  const ageMs = Date.now() - Date.parse(snapshot.checkedAt);
  return c.json({
    success: true,
    data: { ...snapshot, isStale: !Number.isFinite(ageMs) || ageMs > 10 * 60_000 },
  });
});

operations.post(
  '/api/operations/health/check',
  requireRole('owner', 'admin'),
  async (c) => c.json({ success: true, data: await runOperationHealthChecks(c.env, new Date(), { force: true }) }),
);

operations.get('/api/operations/alerts', requireRole('owner', 'admin'), async (c) => {
  const includeResolved = c.req.query('include_resolved') === '1';
  return c.json({
    success: true,
    data: await listOperationHealthAlerts(c.env.DB, {
      includeResolved,
      limit: Number(c.req.query('limit') ?? 100),
    }),
  });
});

operations.post(
  '/api/operations/alerts/:id/acknowledge',
  requireRole('owner', 'admin'),
  async (c) => {
    const alert = await acknowledgeOperationHealthAlert(c.env.DB, {
      alertId: c.req.param('id'),
      actorId: c.get('staff')!.id,
      now: new Date().toISOString(),
    });
    return alert
      ? c.json({ success: true, data: alert })
      : c.json({ success: false, error: 'アラートが見つかりません' }, 404);
  },
);

operations.get('/api/operations/control/preview', async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  if (!await canUseScope(c, accountId)) return c.json({ success: false, error: 'Forbidden' }, 403);
  const [control, broadcasts, scenarios, reminders, automations] = await Promise.all([
    getOperationControlSet(c.env.DB, accountId),
    countActive(c.env.DB, 'broadcasts', "status IN ('scheduled', 'sending')", accountId),
    countActive(c.env.DB, 'scenarios', 'is_active = 1', accountId),
    countActive(c.env.DB, 'reminders', 'is_active = 1', accountId),
    countActive(c.env.DB, 'automations', 'is_active = 1', accountId),
  ]);
  return c.json({
    success: true,
    data: {
      control,
      counts: {
        broadcast_dispatch: broadcasts,
        scenario_dispatch: scenarios,
        reminder_dispatch: reminders,
        automation_actions: automations,
      },
      calculatedAt: new Date().toISOString(),
    },
  });
});

operations.get('/api/operations/history', async (c) => {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const incidents = await listOperationIncidents(c.env.DB, {
    accountIds: scope.allowedAccountIds,
    includeGlobal: c.get('staff')?.role === 'owner',
    limit: Number(c.req.query('limit') ?? 100),
  });
  return c.json({ success: true, data: incidents });
});

operations.post(
  '/api/operations/incidents',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('operation-stop'),
  async (c) => {
    const body = await c.req.json<{
      lineAccountId?: string | null;
      capabilities?: unknown;
      reason?: unknown;
      detail?: unknown;
      expectedVersion?: unknown;
      confirmation?: unknown;
    }>();
    const accountId = body.lineAccountId ?? null;
    if (!await canUseScope(c, accountId)) return c.json({ success: false, error: 'Forbidden' }, 403);
    const capabilities = parseCapabilities(body.capabilities);
    if (!capabilities) return c.json({ success: false, error: '停止対象を1つ以上正しく指定してください' }, 400);
    if (body.confirmation !== '停止') return c.json({ success: false, error: '確認のため「停止」と入力してください' }, 400);
    if (typeof body.reason !== 'string' || body.reason.trim().length === 0 || body.reason.length > 200) {
      return c.json({ success: false, error: '停止理由を200文字以内で入力してください' }, 400);
    }
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      return c.json({ success: false, error: 'expectedVersion は0以上の整数で指定してください' }, 400);
    }
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidOperationIdempotencyKey(idempotencyKey)) {
      return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
    }
    const detail = typeof body.detail === 'string' && body.detail.trim()
      ? body.detail.trim().slice(0, 1000)
      : null;
    const actorId = c.get('staff')!.id;
    const reservation = await reserveOperationIdempotency(c.env.DB, {
      key: idempotencyKey,
      action: 'stop',
      actorId,
      scopeKey: operationScopeKey(accountId),
      requestHash: await hashOperationRequest({
        lineAccountId: accountId,
        capabilities: [...capabilities].sort(),
        reason: body.reason.trim(),
        detail,
        expectedVersion: Number(body.expectedVersion),
      }),
      now: new Date(),
    });
    if (reservation.kind === 'cached') return replayJson(reservation.body, reservation.status);
    if (reservation.kind === 'in_progress') {
      return c.json({ success: false, error: '同じ停止操作を処理中です。結果を読み直してください。' }, 409);
    }
    if (reservation.kind === 'conflict') {
      return c.json({ success: false, error: '同じIdempotency-Keyを別の操作へ再利用できません。' }, 409);
    }
    const result = await stopOperationCapabilities(c.env.DB, {
      lineAccountId: accountId,
      capabilities,
      expectedVersion: Number(body.expectedVersion),
      actorId,
      reason: body.reason.trim(),
      detail,
    });
    if (result.status === 'conflict') {
      const response = { success: false, error: '別の管理者が先に変更しました。最新の状態を読み直してください。', data: result.control };
      await finalizeOperationIdempotency(c.env.DB, { key: idempotencyKey, status: 409, body: response });
      return c.json(response, 409);
    }
    const response = { success: true, data: result };
    await finalizeOperationIdempotency(c.env.DB, { key: idempotencyKey, status: 201, body: response });
    return c.json(response, 201);
  },
);

operations.post(
  '/api/operations/incidents/:id/restore-preview',
  requireRole('owner', 'admin'),
  async (c) => {
    const incident = await getOperationIncident(c.env.DB, c.req.param('id'));
    if (!incident || incident.status !== 'stopped') {
      return c.json({ success: false, error: '復旧できる停止記録ではありません' }, 409);
    }
    if (!await canUseScope(c, incident.lineAccountId)) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const blockers = await countRestoreBlockers(c.env.DB, incident);
    return c.json({
      success: true,
      data: {
        incidentId: incident.id,
        controlVersion: (await getOperationControlSet(c.env.DB, incident.lineAccountId)).version,
        blockers,
        canRestore: !hasRestoreBlockers(blockers),
        calculatedAt: new Date().toISOString(),
      },
    });
  },
);

operations.post(
  '/api/operations/incidents/:id/restore',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('operation-restore'),
  async (c) => {
    const incident = await getOperationIncident(c.env.DB, c.req.param('id'));
    if (!incident) return c.json({ success: false, error: '停止記録が見つかりません' }, 404);
    if (!await canUseScope(c, incident.lineAccountId)) return c.json({ success: false, error: 'Forbidden' }, 403);
    const body = await c.req.json<{ expectedVersion?: unknown; confirmation?: unknown }>();
    if (body.confirmation !== '復旧') return c.json({ success: false, error: '確認のため「復旧」と入力してください' }, 400);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      return c.json({ success: false, error: 'expectedVersion は1以上の整数で指定してください' }, 400);
    }
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidOperationIdempotencyKey(idempotencyKey)) {
      return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
    }
    const actorId = c.get('staff')!.id;
    const reservation = await reserveOperationIdempotency(c.env.DB, {
      key: idempotencyKey,
      action: 'restore',
      actorId,
      scopeKey: incident.scopeKey,
      requestHash: await hashOperationRequest({
        incidentId: incident.id,
        expectedVersion: Number(body.expectedVersion),
      }),
      now: new Date(),
    });
    if (reservation.kind === 'cached') return replayJson(reservation.body, reservation.status);
    if (reservation.kind === 'in_progress') {
      return c.json({ success: false, error: '同じ復旧操作を処理中です。結果を読み直してください。' }, 409);
    }
    if (reservation.kind === 'conflict') {
      return c.json({ success: false, error: '同じIdempotency-Keyを別の操作へ再利用できません。' }, 409);
    }
    const blockers = await countRestoreBlockers(c.env.DB, incident);
    if (hasRestoreBlockers(blockers)) {
      const response = {
        success: false,
        error: '期限切れまたは実行待ちの処理があります。内容を整理してから復旧してください。',
        data: { blockers },
      };
      await finalizeOperationIdempotency(c.env.DB, { key: idempotencyKey, status: 409, body: response });
      return c.json(response, 409);
    }
    const result = await restoreOperationIncident(c.env.DB, {
      incidentId: incident.id,
      expectedVersion: Number(body.expectedVersion),
      actorId,
    });
    if (result.status === 'not_found') {
      const response = { success: false, error: '復旧できる停止記録ではありません' };
      await finalizeOperationIdempotency(c.env.DB, { key: idempotencyKey, status: 409, body: response });
      return c.json(response, 409);
    }
    if (result.status === 'conflict') {
      const response = { success: false, error: '別の管理者が先に変更しました。最新の状態を読み直してください。', data: result.control };
      await finalizeOperationIdempotency(c.env.DB, { key: idempotencyKey, status: 409, body: response });
      return c.json(response, 409);
    }
    const response = { success: true, data: result };
    await finalizeOperationIdempotency(c.env.DB, { key: idempotencyKey, status: 200, body: response });
    return c.json(response);
  },
);

export { operations };
