import { listQueryNumber } from '../lib/list-paging.js';
import { fail } from '../lib/fail.js';
import { logger } from '@line-crm/shared/server';
import { inputJsonBoundary } from '../lib/input-errors.js';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DEFAULT_TENANT_ID, getFriendBulkRunDetail } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { requireRole } from '../middleware/role-guard.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import {
  createFriendBulkUndoRun,
  FriendBulkRunError,
  previewFriendBulkRun,
  processFriendBulkRun,
  requireFriendBulkRunAccess,
  retryFriendBulkRun,
  startFriendBulkRun,
} from '../features/friends/friend-bulk-runs/index.js';

import { approveBulkMessage, getBulkMessageApproval } from '../features/friends/friend-bulk-message-approval/index.js';

export const friendBulkRuns = new Hono<Env>();

function bulkErrorFields(code: string): string[] {
  if (['invalid_selection', 'selection_empty', 'saved_search_invalid', 'conditions_invalid', 'no_targets'].includes(code)) return ['selection'];
  if (code === 'invalid_operation' || code === 'invalid_datetime' || code.startsWith('common_action_')) return ['operation'];
  if (code.startsWith('preview_')) return ['previewToken'];
  return [];
}

function errorResponse(c: Context<Env>, error: unknown) {
  if (error instanceof FriendBulkRunError) {
    return fail(c, error.status as ContentfulStatusCode, error.code, { error: error.message }, bulkErrorFields(error.code));
  }
  throw error;
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
    void promise.catch((error) => logger.error("friend_bulk_runs.keep_running_failed"));
  }
}

async function parseJsonBody<T>(c: Context<Env>): Promise<T> {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
    throw new FriendBulkRunError('request_too_large', '一括操作の指定が大きすぎます', 413);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FriendBulkRunError('invalid_json', '一括操作の指定を読み取れません', 400);
  }
}

friendBulkRuns.post('/api/friends/bulk-runs/preview', requireRole('owner', 'admin'), inputJsonBoundary({}, { maxBytes: 1024 * 1024, tooLarge: { code: 'request_too_large', error: '一括操作の指定が大きすぎます' } }), async (c) => {
  try {
    const body = await parseJsonBody<{ selection?: unknown; operation?: unknown }>(c);
    const result = await previewFriendBulkRun(c.env.DB, c.get('staff')!, body.selection, body.operation);
    return c.json({ success: true, data: result.preview });
  } catch (error) {
    return errorResponse(c, error);
  }
});

friendBulkRuns.post('/api/friends/bulk-runs', requireRole('owner', 'admin'), inputJsonBoundary({}, { maxBytes: 1024 * 1024, tooLarge: { code: 'request_too_large', error: '一括操作の指定が大きすぎます' } }), async (c) => {
  try {
    const body = await parseJsonBody<{ selection?: unknown; operation?: unknown; scheduledAt?: unknown }>(c);
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
    return c.json({ success: true, data: { ...result.run, approval: await getBulkMessageApproval(c.env.DB, result.run.id) } }, result.created ? 202 : 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

friendBulkRuns.get('/api/friends/bulk-runs/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const staff = c.get('staff')!;
    await requireFriendBulkRunAccess(c.env.DB, staff, c.req.param('id'));
    const detail = await getFriendBulkRunDetail(
      c.env.DB,
      c.req.param('id'),
      staff.tenantId ?? DEFAULT_TENANT_ID,
      {
        page: listQueryNumber(c.req.query('page'), 1),
        limit: listQueryNumber(c.req.query('limit'), 50),
      },
    );
    if (!detail) return c.json({ success: false, error: '一括操作が見つかりません' }, 404);
    return c.json({ success: true, data: { ...detail, approval: await getBulkMessageApproval(c.env.DB, detail.id) } });
  } catch (error) {
    return errorResponse(c, error);
  }
});

friendBulkRuns.post('/api/friends/bulk-runs/:id/retry', requireRole('owner', 'admin'), inputJsonBoundary({}, { maxBytes: 1024 * 1024, tooLarge: { code: 'request_too_large', error: '一括操作の指定が大きすぎます' } }), async (c) => {
  try {
    const staff = c.get('staff')!;
    const count = await retryFriendBulkRun(
      c.env.DB,
      c.req.param('id'),
      staff,
    );
    keepRunning(c, processFriendBulkRun(c.env.DB, c.req.param('id'), {
      executorDependencies: { credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY },
    }));
    return c.json({ success: true, data: { retriedCount: count } }, 202);
  } catch (error) {
    return errorResponse(c, error);
  }
});

friendBulkRuns.post('/api/friends/bulk-runs/:id/undo', requireRole('owner', 'admin'), inputJsonBoundary({}, { maxBytes: 1024 * 1024, tooLarge: { code: 'request_too_large', error: '一括操作の指定が大きすぎます' } }), async (c) => {
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

friendBulkRuns.post('/api/friends/bulk-runs/:id/approve', requireRole('owner', 'admin'), inputJsonBoundary({}, { maxBytes: 1024 * 1024, tooLarge: { code: 'request_too_large', error: '一括操作の指定が大きすぎます' } }), async (c) => {
  try {
    const body = await parseJsonBody<{ confirmedRecipientCount?: unknown }>(c);
    const approval = await approveBulkMessage(c.env.DB, c.get('staff')!, c.req.param('id'), body.confirmedRecipientCount);
    keepRunning(c, processFriendBulkRun(c.env.DB, c.req.param('id'), {
      executorDependencies: { credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY },
    }));
    return c.json({ success: true, data: { approval } }, 202);
  } catch (error) {
    return errorResponse(c, error);
  }
});
