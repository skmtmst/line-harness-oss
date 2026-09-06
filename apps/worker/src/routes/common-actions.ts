import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import {
  CommonActionValidationError,
  createCommonAction,
  createCommonActionDraft,
  duplicateCommonAction,
  getCommonActionDetail,
  listCommonActionResources,
  listCommonActions,
  publishCommonActionDraft,
  updateCommonActionBindingVersion,
  updateCommonActionDraft,
} from '../services/common-actions.js';

const commonActions = new Hono<Env>();

function accountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || c.req.query('lineAccountId') || null;
}

async function requireAccount(c: Context<Env>): Promise<string | Response> {
  const id = accountId(c);
  if (!id) return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.ids.includes(id)) {
    return c.json({ success: false, error: '対象のLINE公式アカウントが見つかりません' }, 404);
  }
  return id;
}

function validationResponse(c: Context<Env>, error: CommonActionValidationError): Response {
  const conflict = new Set(['version_conflict', 'draft_exists']);
  const notFound = new Set([
    'not_found', 'draft_not_found', 'base_version_not_found', 'version_not_found', 'binding_not_found',
  ]);
  const status = conflict.has(error.code) ? 409 : notFound.has(error.code) ? 404 : 422;
  return c.json({
    success: false,
    error: error.message,
    code: error.code,
    ...(error.field ? { field: error.field } : {}),
  }, status);
}

function nonNegativeInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CommonActionValidationError('pagination_invalid', 'ページ指定を確認してください', field);
  }
  return parsed;
}

function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function commonActionsCsv(items: Awaited<ReturnType<typeof listCommonActions>>['items']): string {
  const header = ['名前', '状態', '公開版', '中の処理', '呼び出し場所', '今月の実行', '今月の失敗', '最終実行'];
  const rows = items.map((item) => [
    item.name,
    item.status,
    item.publishedVersion,
    item.actionCount,
    item.bindingCount,
    item.executionCountThisMonth,
    item.failureCountThisMonth,
    item.lastRunAt,
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

async function endpoint<T>(
  c: Context<Env>,
  run: () => Promise<T>,
  successStatus = 200,
): Promise<Response> {
  try {
    const data = await run();
    return c.json({ success: true, data }, successStatus as 200);
  } catch (error) {
    if (error instanceof CommonActionValidationError) return validationResponse(c, error);
    console.error(JSON.stringify({
      event: 'common_action_api_failed',
      path: c.req.path,
      reason: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ success: false, error: '共通アクションを処理できませんでした' }, 500);
  }
}

commonActions.get('/api/common-actions', requireRole('owner', 'admin', 'staff'), async (c) => {
  const id = await requireAccount(c);
  if (typeof id !== 'string') return id;
  try {
    const format = c.req.query('format');
    if (format && format !== 'csv') {
      throw new CommonActionValidationError('format_invalid', '書き出し形式を確認してください', 'format');
    }
    if (format === 'csv') {
      const staff = c.get('staff');
      if (staff?.role === 'staff' && !staff.permissionKeys?.includes('automation.run.export')) {
        return c.json({ success: false, error: 'CSVを書き出す権限がありません' }, 403);
      }
    }
    const requestedLimit = nonNegativeInteger(c.req.query('limit'), 'limit');
    const limit = requestedLimit === undefined ? undefined : Math.max(1, Math.min(requestedLimit, 500));
    const offset = nonNegativeInteger(c.req.query('offset'), 'offset') ?? 0;
    const result = await listCommonActions(c.env.DB, {
      lineAccountId: id,
      status: c.req.query('status'),
      query: c.req.query('query'),
      ...(format === 'csv' ? {} : { limit, offset }),
    });
    if (format === 'csv') {
      return c.body(commonActionsCsv(result.items), 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="common-actions.csv"',
      });
    }
    return c.json({
      success: true,
      data: result.items,
      pagination: { total: result.total, limit: limit ?? null, offset },
      freshness: 'available',
    });
  } catch (error) {
    if (error instanceof CommonActionValidationError) return validationResponse(c, error);
    console.error(JSON.stringify({
      event: 'common_action_api_failed', path: c.req.path,
      reason: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ success: false, error: '共通アクションを処理できませんでした' }, 500);
  }
});

commonActions.post('/api/common-actions', requireRole('owner', 'admin'), async (c) => {
  const id = await requireAccount(c);
  if (typeof id !== 'string') return id;
  const body = await c.req.json<{
    name?: unknown;
    description?: unknown;
    actions?: unknown;
  }>().catch(() => ({} as {
    name?: unknown;
    description?: unknown;
    actions?: unknown;
  }));
  return endpoint(c, () => createCommonAction(c.env.DB, {
    lineAccountId: id,
    name: body.name,
    description: body.description,
    actions: body.actions,
    createdBy: c.get('staff')?.id,
  }), 201);
});

commonActions.get('/api/common-actions/resources', requireRole('owner', 'admin'), async (c) => {
  const id = await requireAccount(c);
  if (typeof id !== 'string') return id;
  const trigger = c.req.query('trigger');
  if (trigger && trigger !== 'tag.added') {
    return c.json({
      success: false,
      code: 'trigger_invalid',
      error: '対応していないきっかけです',
    }, 422);
  }
  return endpoint(c, () => listCommonActionResources(c.env.DB, {
    lineAccountId: id,
    excludeCommonActionId: c.req.query('exclude_id'),
    trigger: trigger === 'tag.added' ? trigger : undefined,
  }));
});

commonActions.get('/api/common-actions/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const id = await requireAccount(c);
  if (typeof id !== 'string') return id;
  return endpoint(c, () => getCommonActionDetail(c.env.DB, {
    id: c.req.param('id'),
    lineAccountId: id,
  }));
});

commonActions.post('/api/common-actions/:id/duplicate', requireRole('owner', 'admin'), async (c) => {
  const id = await requireAccount(c);
  if (typeof id !== 'string') return id;
  return endpoint(c, () => duplicateCommonAction(c.env.DB, {
    id: c.req.param('id'),
    lineAccountId: id,
    createdBy: c.get('staff')?.id,
  }), 201);
});

commonActions.put('/api/common-actions/:id/draft', requireRole('owner', 'admin'), async (c) => {
  const id = await requireAccount(c);
  if (typeof id !== 'string') return id;
  const body = await c.req.json<{
    expectedDraftVersionId?: unknown;
    name?: unknown;
    description?: unknown;
    actions?: unknown;
  }>().catch(() => ({} as {
    expectedDraftVersionId?: unknown;
    name?: unknown;
    description?: unknown;
    actions?: unknown;
  }));
  return endpoint(c, async () => {
    await updateCommonActionDraft(c.env.DB, {
      id: c.req.param('id'),
      lineAccountId: id,
      expectedDraftVersionId: body.expectedDraftVersionId,
      name: body.name,
      description: body.description,
      actions: body.actions,
    });
    return { updated: true };
  });
});

commonActions.post('/api/common-actions/:id/versions', requireRole('owner', 'admin'), async (c) => {
  const id = await requireAccount(c);
  if (typeof id !== 'string') return id;
  const body = await c.req.json<{ fromVersionId?: unknown }>()
    .catch(() => ({} as { fromVersionId?: unknown }));
  return endpoint(c, () => createCommonActionDraft(c.env.DB, {
    id: c.req.param('id'),
    lineAccountId: id,
    fromVersionId: body.fromVersionId,
    createdBy: c.get('staff')?.id,
  }), 201);
});

commonActions.post(
  '/api/common-actions/:id/versions/:versionId/publish',
  requireRole('owner', 'admin'),
  async (c) => {
    const id = await requireAccount(c);
    if (typeof id !== 'string') return id;
    return endpoint(c, () => publishCommonActionDraft(c.env.DB, {
      id: c.req.param('id'),
      lineAccountId: id,
      draftVersionId: c.req.param('versionId'),
    }));
  },
);

commonActions.post(
  '/api/common-actions/:id/bindings/:bindingId/version',
  requireRole('owner', 'admin'),
  async (c) => {
    const id = await requireAccount(c);
    if (typeof id !== 'string') return id;
    const body = await c.req.json<{ versionId?: unknown; expectedVersionId?: unknown }>()
      .catch(() => ({} as { versionId?: unknown; expectedVersionId?: unknown }));
    return endpoint(c, async () => {
      await updateCommonActionBindingVersion(c.env.DB, {
        id: c.req.param('id'),
        bindingId: c.req.param('bindingId'),
        lineAccountId: id,
        versionId: body.versionId,
        expectedVersionId: body.expectedVersionId,
        actorId: c.get('staff')?.id,
      });
      return { updated: true };
    });
  },
);

export { commonActions };
