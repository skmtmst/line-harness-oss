import { logger } from '@line-crm/shared/server';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { inputError } from '../lib/input-errors.js';
import { assignmentResourceIds, assignmentSettingsWithResources, d1AssignmentSettingsStore, validAssignmentWrite, type AssignmentScope } from '../features/booking/booking-assignment-settings/index.js';

/** 所属・店舗・予約設定権限は既存の各ルートで確認する。 */
export async function assignmentSettingsResponse(c: Context<Env>, db: D1Database, scope: AssignmentScope) {
  c.header('Cache-Control', 'no-store');
  try {
    if (c.req.method === 'GET') return c.json({ success: true, data: await assignmentSettingsWithResources(db, scope) });
    if (c.get('staff')?.readOnly) return c.json({ success: false, error: 'forbidden' }, 403);
    const input: unknown = await c.req.json().catch(() => null);
    if (!validAssignmentWrite(input)) return inputError(c, { success: false, error: 'invalid_assignment_settings' }, 400,
      ['method', 'balancePeriod', 'resources', 'expectedVersion']);
    const ids = new Set(await assignmentResourceIds(db, scope));
    if (input.resources.some(r => !ids.has(r.resourceId))) return inputError(c,
      { success: false, error: 'invalid_assignment_resource' }, 400, ['resources']);
    const status = await d1AssignmentSettingsStore(db).save(scope, input);
    if (status === 'unavailable') return c.json({ success: false, error: 'assignment_storage_not_ready' }, 503);
    if (status === 'conflict') return c.json({ success: false, error: 'version_conflict' }, 409);
    return c.json({ success: true, data: await assignmentSettingsWithResources(db, scope) });
  } catch {
    logger.error("assignment_settings_unavailable");
    return c.json({ success: false, error: 'assignment_settings_unavailable' }, 503);
  }
}
