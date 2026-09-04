import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  ActionScoreRuleValidationError,
  getActionScoreBands,
  getActionScoreRuleConfiguration,
  publishActionScoreRuleDraft,
  saveActionScoreRuleDraft,
  stopActionScoreRules,
  testActionScoreRuleBundle,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

const actionScoreRules = new Hono<Env>();

async function requireAccount(c: Context<Env>, value: unknown): Promise<string | Response> {
  const accountId = typeof value === 'string' ? value.trim() : '';
  if (!accountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.allowedAccountIds.includes(accountId)) {
    return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  }
  return accountId;
}

function validationResponse(c: Context<Env>, error: ActionScoreRuleValidationError): Response {
  const conflict = error.code === 'version_conflict';
  const notFound = new Set(['draft_not_found', 'published_version_required', 'published_version_missing']);
  return c.json({
    success: false,
    error: error.message,
    code: error.code,
    ...(error.field ? { field: error.field } : {}),
  }, conflict ? 409 : notFound.has(error.code) ? 404 : 422);
}

async function endpoint<T>(c: Context<Env>, run: () => Promise<T>, status = 200): Promise<Response> {
  try {
    return c.json({ success: true, data: await run() }, status as 200);
  } catch (error) {
    if (error instanceof ActionScoreRuleValidationError) return validationResponse(c, error);
    console.error(JSON.stringify({
      event: 'action_score_rule_api_failed',
      path: c.req.path,
      reason: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ success: false, error: 'スコアのルールを処理できませんでした' }, 500);
  }
}

actionScoreRules.get('/api/action-scores/rules', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c, c.req.query('accountId'));
  if (typeof accountId !== 'string') return accountId;
  return endpoint(c, () => getActionScoreRuleConfiguration(c.env.DB, accountId));
});

actionScoreRules.get('/api/action-scores/bands', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c, c.req.query('accountId'));
  if (typeof accountId !== 'string') return accountId;
  return endpoint(c, () => getActionScoreBands(c.env.DB, accountId));
});

actionScoreRules.patch('/api/action-scores/rules/draft', requireRole('owner', 'admin'), async (c) => {
  type Body = {
    accountId?: unknown;
    expectedDraftVersionId?: unknown;
    configuration?: unknown;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const accountId = await requireAccount(c, body.accountId);
  if (typeof accountId !== 'string') return accountId;
  return endpoint(c, async () => {
    const data = await saveActionScoreRuleDraft(c.env.DB, {
      lineAccountId: accountId,
      expectedDraftVersionId: typeof body.expectedDraftVersionId === 'string'
        ? body.expectedDraftVersionId
        : null,
      configuration: body.configuration,
      createdBy: c.get('staff').id,
    });
    auditLog(c, 'action_score.rules.draft.save', { kind: 'line_account', id: accountId });
    return data;
  });
});

actionScoreRules.post('/api/action-scores/rules/test', requireRole('owner', 'admin'), async (c) => {
  type Body = {
    accountId?: unknown;
    configuration?: unknown;
    currentScore?: unknown;
    eventType?: unknown;
    source?: unknown;
    occurredAt?: unknown;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const accountId = await requireAccount(c, body.accountId);
  if (typeof accountId !== 'string') return accountId;
  return endpoint(c, async () => {
    const current = body.configuration
      ? body.configuration
      : await getActionScoreRuleConfiguration(c.env.DB, accountId).then((config) => ({
          rules: config.editableVersion.rules,
          bands: config.editableVersion.bands,
        }));
    return testActionScoreRuleBundle(current, {
      currentScore: Number(body.currentScore),
      eventType: typeof body.eventType === 'string' ? body.eventType : '',
      source: typeof body.source === 'string' ? body.source : null,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
  });
});

actionScoreRules.post(
  '/api/action-scores/rules/publish',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('action-score-rules-publish'),
  async (c) => {
    type Body = { accountId?: unknown; draftVersionId?: unknown };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    const accountId = await requireAccount(c, body.accountId);
    if (typeof accountId !== 'string') return accountId;
    const draftVersionId = typeof body.draftVersionId === 'string' ? body.draftVersionId : '';
    return endpoint(c, async () => {
      const data = await publishActionScoreRuleDraft(c.env.DB, {
        lineAccountId: accountId,
        draftVersionId,
        publishedBy: c.get('staff').id,
      });
      auditLog(c, 'action_score.rules.publish', { kind: 'line_account', id: accountId });
      return data;
    });
  },
);

actionScoreRules.post('/api/action-scores/rules/stop', requireRole('owner', 'admin'), async (c) => {
  type Body = { accountId?: unknown };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const accountId = await requireAccount(c, body.accountId);
  if (typeof accountId !== 'string') return accountId;
  return endpoint(c, async () => {
    const data = await stopActionScoreRules(c.env.DB, accountId);
    auditLog(c, 'action_score.rules.stop', { kind: 'line_account', id: accountId });
    return data;
  });
});

export { actionScoreRules };
