import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import {
  OPERATION_CAPABILITIES,
  consumeStepUpGrant,
  enqueueOperationNotifications,
  getLatestOperationHealthRun,
  getOperationControlSet,
  getOperationIncident,
  getOperationRequestReceipt,
  listOperationDeploymentEvents,
  listOperationIncidents,
  recordOperationDeploymentEvent,
  recordOperation,
  restoreOperationIncident,
  saveOperationRequestReceipt,
  stopOperationCapabilities,
  type OperationCapability,
} from '@line-crm/db';

import type { Env } from '../index.js';
import { sha256Hex } from '../middleware/auth.js';
import { requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { getOperationImpactPreview } from '../services/operation-impact-preview.js';
import { runOperationHealthChecks } from '../services/operations-health.js';
import { verifyOperationsEvent } from '../services/operations-signature.js';

export const operations = new Hono<Env>();

export const EMERGENCY_CONTROL_PERMISSION = 'operations.control.execute';

function canControlEmergency(c: Context<Env>): boolean {
  const staff = c.get('staff');
  if (staff?.role === 'owner') return true;
  return staff?.role === 'admin'
    && staff.permissionKeys?.includes(EMERGENCY_CONTROL_PERMISSION) === true;
}

async function requireEmergencyControlPermission(c: Context<Env>, next: Next) {
  if (!canControlEmergency(c)) {
    return c.json({
      success: false,
      error: '緊急停止・復旧の専用権限がありません。オーナーに権限付与を依頼してください',
      code: 'EMERGENCY_CONTROL_FORBIDDEN',
    }, 403);
  }
  await next();
}

function requestedAccountId(value: string | null | undefined): string | null {
  return !value || value === 'all' ? null : value.trim();
}

async function canReadScope(c: Context<Env>, accountId: string | null): Promise<boolean> {
  if (accountId === null) return true;
  return canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]);
}

async function canControlScope(c: Context<Env>, accountId: string | null): Promise<boolean> {
  if (accountId === null) return c.get('staff')?.role === 'owner';
  return canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]);
}

function parseCapabilities(raw: unknown): OperationCapability[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const capabilities = raw.filter((value): value is OperationCapability =>
    typeof value === 'string' && OPERATION_CAPABILITIES.includes(value as OperationCapability));
  if (capabilities.length !== raw.length || new Set(capabilities).size !== capabilities.length) return null;
  return capabilities;
}

function historyLimit(raw: string | undefined): number {
  const value = Number(raw ?? 100);
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 200) : 100;
}

const STEP_UP_PURPOSE = 'operations.control';

function requiredIdempotencyKey(c: Context<Env>): string | null {
  const key = c.req.header('Idempotency-Key')?.trim() ?? '';
  return key.length >= 8 && key.length <= 200 ? key : null;
}

async function consumeOperationStepUp(c: Context<Env>): Promise<boolean> {
  const token = c.req.header('X-Step-Up-Token')?.trim();
  if (!token) return false;
  return consumeStepUpGrant(c.env.DB, {
    tokenHash: await sha256Hex(token),
    staffId: c.get('staff')!.id,
    purpose: STEP_UP_PURPOSE,
  });
}

async function queueOperationNotifications(
  c: Context<Env>,
  input: {
    incidentId: string;
    eventKind: 'stopped' | 'restored';
    payload: Record<string, unknown>;
  },
): Promise<unknown> {
  try {
    return await enqueueOperationNotifications(c.env.DB, input);
  } catch (error) {
    console.error(`operation ${input.eventKind} notification enqueue error:`, error);
    return { failed: ['line', 'email'] };
  }
}

function staleHealth(run: Awaited<ReturnType<typeof getLatestOperationHealthRun>>) {
  const serverNow = new Date();
  const lastCheckedAt = run?.completedAt ?? run?.startedAt ?? null;
  const stale = !lastCheckedAt || serverNow.getTime() - Date.parse(lastCheckedAt) > 10 * 60_000;
  const nextCheckAt = lastCheckedAt
    ? new Date(Date.parse(lastCheckedAt) + 5 * 60_000).toISOString()
    : null;
  return {
    latestRun: run,
    overallStatus: stale ? 'stale' : run?.overallStatus ?? 'unknown',
    lastCheckedAt,
    nextCheckAt,
    serverNow: serverNow.toISOString(),
  };
}

operations.get('/api/operations/health', requireRole('owner', 'admin'), async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  if (!accountId) return c.json({ success: false, error: 'LINEアカウントを指定してください' }, 400);
  if (!await canReadScope(c, accountId)) {
    return c.json({ success: false, error: 'このアカウントの運用状態を表示する権限がありません', code: 'EMERGENCY_SCOPE_FORBIDDEN' }, 403);
  }
  try {
    return c.json({ success: true, data: staleHealth(await getLatestOperationHealthRun(c.env.DB, accountId)) });
  } catch (error) {
    console.error('GET /api/operations/health error:', error);
    return c.json({ success: false, error: '運用状態を取得できませんでした' }, 500);
  }
});

operations.post('/api/operations/health/runs', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ lineAccountId?: unknown }>()
    .catch(() => ({} as { lineAccountId?: unknown }));
  if (typeof body.lineAccountId !== 'string' || !body.lineAccountId.trim()) {
    return c.json({ success: false, error: 'LINEアカウントを指定してください' }, 400);
  }
  const accountId = body.lineAccountId.trim();
  if (!await canReadScope(c, accountId)) {
    return c.json({ success: false, error: 'このアカウントを確認する権限がありません', code: 'EMERGENCY_SCOPE_FORBIDDEN' }, 403);
  }
  try {
    const checked = await runOperationHealthChecks(c.env.DB, {
      lineAccountId: accountId,
      source: 'manual',
      actorId: c.get('staff')!.id,
    });
    return c.json({ success: true, duplicate: checked.duplicate, data: staleHealth(checked.run) }, checked.duplicate ? 200 : 201);
  } catch (error) {
    console.error('POST /api/operations/health/runs error:', error);
    return c.json({ success: false, error: '運用状態を確認できませんでした' }, 500);
  }
});

operations.get('/api/operations/control', requireRole('owner', 'admin'), async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  if (!await canReadScope(c, accountId)) {
    return c.json({ success: false, error: 'この範囲の緊急停止状態を表示する権限がありません', code: 'EMERGENCY_SCOPE_FORBIDDEN' }, 403);
  }
  try {
    return c.json({ success: true, data: await getOperationControlSet(c.env.DB, accountId) });
  } catch (error) {
    console.error('GET /api/operations/control error:', error);
    return c.json({ success: false, error: '緊急停止状態を取得できませんでした' }, 500);
  }
});

operations.get('/api/operations/control/preview', requireRole('owner', 'admin'), async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  if (accountId === null && c.get('staff')?.role !== 'owner') {
    return c.json({ success: false, error: '全アカウントの影響人数を表示する権限がありません', code: 'EMERGENCY_SCOPE_FORBIDDEN' }, 403);
  }
  if (accountId !== null && !await canReadScope(c, accountId)) {
    return c.json({ success: false, error: 'このアカウントの影響人数を表示する権限がありません', code: 'EMERGENCY_SCOPE_FORBIDDEN' }, 403);
  }
  try {
    const [control, impact] = await Promise.all([
      getOperationControlSet(c.env.DB, accountId),
      getOperationImpactPreview(c.env.DB, accountId),
    ]);
    const counts = {
      broadcast_dispatch: impact.broadcast_dispatch.itemCount,
      scenario_dispatch: impact.scenario_dispatch.itemCount,
      reminder_dispatch: impact.reminder_dispatch.itemCount,
      automation_actions: impact.automation_actions.itemCount,
      auto_reply_dispatch: impact.auto_reply_dispatch.itemCount,
    };
    const calculatedAt = new Date().toISOString();
    await recordOperation(c.env.DB, {
      targetKind: 'emergency_control',
      targetId: accountId ?? '*',
      action: 'previewed',
      actorId: c.get('staff')!.id,
      detail: {
        counts,
        hasUnknownAudience: Object.values(impact).some((metric) => metric.friendCount === null),
        calculatedAt,
      },
    });
    const canControl = canControlEmergency(c);
    return c.json({
      success: true,
      data: {
        control,
        counts,
        impact,
        // N-453: 停止できない理由を画面が運用者向け文言へ変えるための機械コード。
        // 権限があるときは null。文言そのものは画面側が持つ。
        permissions: {
          canControl,
          reasonCode: canControl ? null : 'EMERGENCY_CONTROL_FORBIDDEN',
        },
        calculatedAt,
      },
    });
  } catch (error) {
    console.error('GET /api/operations/control/preview error:', error);
    return c.json({ success: false, error: '緊急停止の影響人数を取得できませんでした' }, 500);
  }
});

operations.get('/api/operations/history', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const limit = historyLimit(c.req.query('limit'));
    const [incidents, deployments] = await Promise.all([
      listOperationIncidents(c.env.DB, {
        accountIds: scope.allowedAccountIds,
        includeGlobal: c.get('staff')?.role === 'owner',
        limit,
      }),
      listOperationDeploymentEvents(c.env.DB, limit),
    ]);
    const history = [
      ...incidents.map((incident) => ({ ...incident, historyKind: 'incident', occurredAt: incident.createdAt })),
      ...deployments.map((deployment) => ({
        id: `deployment:${deployment.id}`,
        historyKind: 'deployment',
        occurredAt: deployment.occurredAt,
        scopeKey: '*',
        lineAccountId: null,
        status: deployment.phase === 'succeeded' ? 'resolved' : deployment.phase === 'failed' ? 'failed' : 'preparing',
        capabilities: [],
        reason: deployment.releaseSummary ?? `${deployment.environment}へ更新`,
        detail: deployment.version,
        actorId: deployment.actor,
        resolvedByActorId: null,
        controlVersion: null,
        beforeSnapshot: null,
        stoppedSnapshot: null,
        restoredSnapshot: null,
        errorMessage: deployment.phase === 'failed' ? '配備に失敗しました' : null,
        stoppedAt: null,
        resolvedAt: deployment.phase === 'succeeded' ? deployment.occurredAt : null,
        createdAt: deployment.occurredAt,
        updatedAt: deployment.receivedAt,
        deployment,
      })),
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    console.error('GET /api/operations/history error:', error);
    return c.json({ success: false, error: '緊急操作の履歴を取得できませんでした' }, 500);
  }
});

operations.get('/api/operations/incidents/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const incident = await getOperationIncident(c.env.DB, c.req.param('id'));
    if (!incident) return c.json({ success: false, error: '緊急操作の記録が見つかりません' }, 404);
    if (!await canReadScope(c, incident.lineAccountId)) {
      return c.json({ success: false, error: 'この緊急操作を表示する権限がありません', code: 'EMERGENCY_SCOPE_FORBIDDEN' }, 403);
    }
    return c.json({ success: true, data: incident });
  } catch (error) {
    console.error('GET /api/operations/incidents/:id error:', error);
    return c.json({ success: false, error: '緊急操作の記録を取得できませんでした' }, 500);
  }
});

operations.post(
  '/api/operations/incidents',
  requireRole('owner', 'admin'),
  requireEmergencyControlPermission,
  requireIrreversibleConfirmation('operation-stop'),
  async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ success: false, error: '入力内容を読み取れませんでした' }, 400);
    }
    if (!Object.hasOwn(body, 'lineAccountId')
      || (body.lineAccountId !== null && typeof body.lineAccountId !== 'string')) {
      return c.json({ success: false, error: '停止する範囲を明示してください' }, 400);
    }
    const accountId = requestedAccountId(
      typeof body.lineAccountId === 'string' ? body.lineAccountId : null,
    );
    if (!await canControlScope(c, accountId)) {
      return c.json({ success: false, error: 'この範囲を緊急停止する権限がありません', code: 'EMERGENCY_SCOPE_FORBIDDEN' }, 403);
    }
    const capabilities = parseCapabilities(body.capabilities);
    if (!capabilities) {
      return c.json({ success: false, error: '停止対象を1つ以上正しく指定してください' }, 400);
    }
    if (body.confirmation !== '停止') {
      return c.json({ success: false, error: '確認のため「停止」と入力してください' }, 400);
    }
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 200) {
      return c.json({ success: false, error: '停止理由を200文字以内で入力してください' }, 400);
    }
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      return c.json({ success: false, error: '最新の停止状態を読み直してください' }, 400);
    }
    const detail = typeof body.detail === 'string' && body.detail.trim()
      ? body.detail.trim().slice(0, 1_000)
      : null;

    const idempotencyKey = requiredIdempotencyKey(c);
    if (!idempotencyKey) {
      return c.json({ success: false, error: '再実行を安全にするキーを指定してください' }, 400);
    }
    const actorId = c.get('staff')!.id;
    const requestHash = await sha256Hex(JSON.stringify({
      lineAccountId: accountId, capabilities, reason: body.reason.trim(), detail,
      expectedVersion: Number(body.expectedVersion),
    }));
    const previous = await getOperationRequestReceipt(c.env.DB, 'stop', actorId, idempotencyKey);
    if (previous) {
      if (previous.requestHash !== requestHash) {
        return c.json({ success: false, error: '同じ再実行キーが別の内容で使われています', code: 'IDEMPOTENCY_CONFLICT' }, 409);
      }
      const incident = await getOperationIncident(c.env.DB, previous.resourceId);
      if (!incident) return c.json({ success: false, error: '以前の実行結果を取得できませんでした' }, 500);
      const control = await getOperationControlSet(c.env.DB, incident.lineAccountId);
      const notifications = await queueOperationNotifications(c, {
        incidentId: incident.id,
        eventKind: 'stopped',
        payload: { lineAccountId: incident.lineAccountId, capabilities: incident.capabilities, reason: incident.reason, actorId },
      });
      return c.json({ success: true, duplicate: true, data: { status: 'changed', control, incident, notifications } });
    }
    if (!await consumeOperationStepUp(c)) {
      return c.json({ success: false, error: '重要操作の再認証が必要です' }, 401);
    }

    try {
      const result = await stopOperationCapabilities(c.env.DB, {
        lineAccountId: accountId,
        capabilities,
        expectedVersion: Number(body.expectedVersion),
        actorId,
        reason: body.reason.trim(),
        detail,
      });
      if (result.status === 'conflict') {
        return c.json({
          success: false,
          error: '別の管理者が先に変更しました。最新の状態を読み直してください。',
          code: 'VERSION_CONFLICT',
          data: result.control,
        }, 409);
      }
      await saveOperationRequestReceipt(c.env.DB, {
        action: 'stop', actorId, idempotencyKey, requestHash, resourceId: result.incident.id,
      });
      const notifications = await queueOperationNotifications(c, {
        incidentId: result.incident.id,
        eventKind: 'stopped',
        payload: { lineAccountId: accountId, capabilities, reason: body.reason.trim(), actorId },
      });
      return c.json({ success: true, data: { ...result, notifications } }, 201);
    } catch (error) {
      console.error('POST /api/operations/incidents error:', error);
      return c.json({ success: false, error: '緊急停止状態を保存できませんでした' }, 500);
    }
  },
);

operations.post(
  '/api/operations/incidents/:id/restore',
  requireRole('owner', 'admin'),
  requireEmergencyControlPermission,
  requireIrreversibleConfirmation('operation-restore'),
  async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ success: false, error: '入力内容を読み取れませんでした' }, 400);
    }
    if (body.confirmation !== '復旧') {
      return c.json({ success: false, error: '確認のため「復旧」と入力してください' }, 400);
    }
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      return c.json({ success: false, error: '最新の停止状態を読み直してください' }, 400);
    }

    const idempotencyKey = requiredIdempotencyKey(c);
    if (!idempotencyKey) {
      return c.json({ success: false, error: '再実行を安全にするキーを指定してください' }, 400);
    }

    try {
      const incident = await getOperationIncident(c.env.DB, c.req.param('id'));
      if (!incident) return c.json({ success: false, error: '緊急操作の記録が見つかりません' }, 404);
      if (!await canControlScope(c, incident.lineAccountId)) {
        return c.json({ success: false, error: 'この範囲を復旧する権限がありません', code: 'EMERGENCY_SCOPE_FORBIDDEN' }, 403);
      }
      const actorId = c.get('staff')!.id;
      const action = `restore:${incident.id}`;
      const requestHash = await sha256Hex(JSON.stringify({ expectedVersion: Number(body.expectedVersion) }));
      const previous = await getOperationRequestReceipt(c.env.DB, action, actorId, idempotencyKey);
      if (previous) {
        if (previous.requestHash !== requestHash) {
          return c.json({ success: false, error: '同じ再実行キーが別の内容で使われています', code: 'IDEMPOTENCY_CONFLICT' }, 409);
        }
        const replayed = await getOperationIncident(c.env.DB, previous.resourceId);
        if (!replayed) return c.json({ success: false, error: '以前の実行結果を取得できませんでした' }, 500);
        const control = await getOperationControlSet(c.env.DB, replayed.lineAccountId);
        const notifications = await queueOperationNotifications(c, {
          incidentId: replayed.id,
          eventKind: 'restored',
          payload: { lineAccountId: replayed.lineAccountId, actorId },
        });
        return c.json({ success: true, duplicate: true, data: { status: 'changed', control, incident: replayed, notifications } });
      }
      if (!await consumeOperationStepUp(c)) {
        return c.json({ success: false, error: '重要操作の再認証が必要です' }, 401);
      }
      const result = await restoreOperationIncident(c.env.DB, {
        incidentId: incident.id,
        expectedVersion: Number(body.expectedVersion),
        actorId,
      });
      if (result.status === 'not_found') {
        return c.json({ success: false, error: '復旧できる緊急停止ではありません', code: 'OPERATION_NOT_STOPPED' }, 409);
      }
      if (result.status === 'conflict') {
        return c.json({
          success: false,
          error: '別の管理者が先に変更しました。最新の状態を読み直してください。',
          code: 'VERSION_CONFLICT',
          data: result.control,
        }, 409);
      }
      await saveOperationRequestReceipt(c.env.DB, {
        action, actorId, idempotencyKey, requestHash, resourceId: result.incident.id,
      });
      const notifications = await queueOperationNotifications(c, {
        incidentId: result.incident.id,
        eventKind: 'restored',
        payload: { lineAccountId: result.incident.lineAccountId, actorId },
      });
      return c.json({ success: true, data: { ...result, notifications } });
    } catch (error) {
      console.error('POST /api/operations/incidents/:id/restore error:', error);
      return c.json({ success: false, error: '復旧後の状態を保存できませんでした' }, 500);
    }
  },
);

operations.post('/api/internal/deployments/events', async (c) => {
  const secret = c.env.OPERATIONS_DEPLOYMENT_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    return c.json({ success: false, error: 'Deployment event receiver is not configured' }, 503);
  }
  const rawBody = await c.req.text();
  if (!await verifyOperationsEvent(
    secret,
    c.req.header('X-Operations-Timestamp'),
    c.req.header('X-Operations-Signature'),
    rawBody,
  )) {
    return c.json({ success: false, error: 'Invalid signature' }, 401);
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody) as Record<string, unknown>; } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }
  const phases = ['queued', 'deploying', 'verifying', 'succeeded', 'failed', 'rolled_back'] as const;
  if (
    typeof body.deploymentId !== 'string' || !body.deploymentId.trim()
    || typeof body.environment !== 'string' || !body.environment.trim()
    || typeof body.actor !== 'string' || !body.actor.trim()
    || typeof body.occurredAt !== 'string' || !Number.isFinite(Date.parse(body.occurredAt))
    || typeof body.phase !== 'string' || !phases.includes(body.phase as typeof phases[number])
  ) {
    return c.json({ success: false, error: 'Invalid deployment event' }, 400);
  }
  const migrations = Array.isArray(body.migrations)
    ? body.migrations.filter((value): value is string => typeof value === 'string').slice(0, 100)
    : [];
  const saved = await recordOperationDeploymentEvent(c.env.DB, {
    deploymentId: body.deploymentId.trim().slice(0, 200),
    phase: body.phase as typeof phases[number],
    environment: body.environment.trim().slice(0, 100),
    fromCommit: typeof body.fromCommit === 'string' ? body.fromCommit.slice(0, 100) : null,
    toCommit: typeof body.toCommit === 'string' ? body.toCommit.slice(0, 100) : null,
    version: typeof body.version === 'string' ? body.version.slice(0, 100) : null,
    migrations,
    rollbackAvailable: body.rollbackAvailable === true,
    downtimeSeconds: Number.isInteger(body.downtimeSeconds) && Number(body.downtimeSeconds) >= 0
      ? Number(body.downtimeSeconds) : null,
    pullRequest: Number.isInteger(body.pullRequest) && Number(body.pullRequest) > 0
      ? Number(body.pullRequest) : null,
    releaseSummary: typeof body.releaseSummary === 'string' ? body.releaseSummary.slice(0, 1_000) : null,
    actor: body.actor.trim().slice(0, 200),
    smokeCheck: body.smokeCheck && typeof body.smokeCheck === 'object' && !Array.isArray(body.smokeCheck)
      ? body.smokeCheck as Record<string, unknown> : null,
    occurredAt: new Date(body.occurredAt).toISOString(),
  });
  return c.json({ success: true, duplicate: !saved.created, data: saved.event }, saved.created ? 201 : 200);
});
