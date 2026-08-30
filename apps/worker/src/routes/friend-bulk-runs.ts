import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DEFAULT_TENANT_ID, getFriendBulkRunDetail } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import {
  createFriendBulkUndoRun,
  FriendBulkRunError,
  previewFriendBulkRun,
  processFriendBulkRun,
  retryFriendBulkRun,
  startFriendBulkRun,
} from '../services/friend-bulk-runs.js';

export const friendBulkRuns = new Hono<Env>();

function errorResponse(c: Context<Env>, error: unknown) {
  if (error instanceof FriendBulkRunError) {
    return c.json(
      { success: false, error: error.message, code: error.code },
      error.status as ContentfulStatusCode,
    );
  }
  console.error('friend bulk run error:', error);
  return c.json({ success: false, error: '一括操作を処理できませんでした' }, 500);
}

function idempotencyKey(c: { req: { header(name: string): string | undefined } }): string {
  const value = c.req.header('Idempotency-Key')?.trim();
  if (!isValidIdempotencyKey(value)) {
    throw new FriendBulkRunError('idempotency_key_required', '有効なIdempotency-Keyが必要です');
  }
  return value!;
}

function keepRunning(c: { executionCtx: ExecutionContext }, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise.catch((error) => console.error('friend bulk background error:', error));
  }
}

friendBulkRuns.post('/api/friends/bulk-runs/preview', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const body = await c.req.json<{ selection?: unknown; operation?: unknown }>();
    const result = await previewFriendBulkRun(c.env.DB, c.get('staff')!, body.selection, body.operation);
    return c.json({ success: true, data: result.preview });
  } catch (error) {
    return errorResponse(c, error);
  }
});

friendBulkRuns.post('/api/friends/bulk-runs', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const body = await c.req.json<{ selection?: unknown; operation?: unknown; scheduledAt?: unknown }>();
    const result = await startFriendBulkRun(c.env.DB, c.get('staff')!, {
      selection: body.selection,
      operation: body.operation,
      scheduledAt: body.scheduledAt,
      idempotencyKey: idempotencyKey(c),
      confirmIrreversible: c.req.header('X-Confirm-Irreversible') === 'friend-bulk-run',
    });
    if (result.created) {
      keepRunning(c, processFriendBulkRun(c.env.DB, result.run.id, {
        executorDependencies: { credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY },
      }));
    }
    return c.json({ success: true, data: result.run }, result.created ? 202 : 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

friendBulkRuns.get('/api/friends/bulk-runs/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff')!;
    const detail = await getFriendBulkRunDetail(
      c.env.DB,
      c.req.param('id'),
      staff.tenantId ?? DEFAULT_TENANT_ID,
      {
        page: Number(c.req.query('page') ?? 1),
        limit: Number(c.req.query('limit') ?? 50),
      },
    );
    if (!detail) return c.json({ success: false, error: '一括操作が見つかりません' }, 404);
    return c.json({ success: true, data: detail });
  } catch (error) {
    return errorResponse(c, error);
  }
});

friendBulkRuns.post('/api/friends/bulk-runs/:id/retry', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff')!;
    const count = await retryFriendBulkRun(
      c.env.DB,
      c.req.param('id'),
      staff.tenantId ?? DEFAULT_TENANT_ID,
    );
    keepRunning(c, processFriendBulkRun(c.env.DB, c.req.param('id'), {
      executorDependencies: { credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY },
    }));
    return c.json({ success: true, data: { retriedCount: count } }, 202);
  } catch (error) {
    return errorResponse(c, error);
  }
});

friendBulkRuns.post('/api/friends/bulk-runs/:id/undo', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const result = await createFriendBulkUndoRun(
      c.env.DB,
      c.get('staff')!,
      c.req.param('id'),
      idempotencyKey(c),
    );
    if (result.created) keepRunning(c, processFriendBulkRun(c.env.DB, result.run.id));
    return c.json({ success: true, data: result.run }, result.created ? 202 : 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});
