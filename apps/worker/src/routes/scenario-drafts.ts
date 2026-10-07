import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ScenarioDraft, ScenarioDraftInput } from '@line-crm/shared';
import type { Env } from '../index.js';
import { requirePermission, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

export const scenarioDrafts = new Hono<Env>();
type DraftRow = {
  line_account_id: string;
  draft_key: string;
  content_json: string;
  scenario_id: string | null;
  step_id: string | null;
  version: string;
  updated_by: string;
  updated_at: string;
  expires_at: string;
};
const validVersion = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const serialize = (r: DraftRow): ScenarioDraft => ({
  key: r.draft_key,
  lineAccountId: r.line_account_id,
  content: JSON.parse(r.content_json),
  scenarioId: r.scenario_id,
  stepId: r.step_id,
  version: r.version,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
  expiresAt: r.expires_at,
});
async function access(c: Context<Env>): Promise<string | Response> {
  const accountId = c.req.query('lineAccountId');
  if (!accountId || !/^[^\x00-\x1f]{1,200}$/.test(c.req.param('key') ?? ''))
    return c.json({ success: false, error: 'invalid_key_or_account' }, 400);
  if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])))
    return c.json({ success: false, error: 'not_found' }, 404);
  c.header('Cache-Control', 'no-store');
  return accountId;
}
scenarioDrafts.use(
  '/api/scenario-drafts/*',
  requirePermission('/scenarios'),
  async (c, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.get('staff')?.readOnly
    )
      return c.json({ success: false, error: 'read_only' }, 403);
    await next();
  },
);
scenarioDrafts.get('/api/scenario-drafts/:key', async (c) => {
  const account = await access(c);
  if (account instanceof Response) return account;
  const row = await c.env.DB.prepare(
    'SELECT * FROM scenario_edit_drafts WHERE line_account_id=? AND draft_key=? AND expires_at>?',
  )
    .bind(account, c.req.param('key'), new Date().toISOString())
    .first<DraftRow>();
  return row
    ? c.json({ success: true, data: serialize(row) })
    : c.json({ success: false, error: 'not_found' }, 404);
});
scenarioDrafts.put(
  '/api/scenario-drafts/:key',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const account = await access(c);
    if (account instanceof Response) return account;
    const b = await c.req.json<ScenarioDraftInput>().catch(() => null);
    if (
      !b ||
      !(b.expectedVersion === 0 || validVersion(b.expectedVersion)) ||
      !b.content ||
      typeof b.content !== 'object' ||
      Array.isArray(b.content) ||
      (b.scenarioId != null && typeof b.scenarioId !== 'string') ||
      (b.stepId != null && typeof b.stepId !== 'string') ||
      (b.stepId && !b.scenarioId)
    )
      return c.json({ success: false, error: 'invalid_draft' }, 400);
    const content = JSON.stringify(b.content);
    if (new TextEncoder().encode(content).length > 262144)
      return c.json({ success: false, error: 'draft_too_large' }, 413);
    if (
      b.scenarioId &&
      !(await c.env.DB.prepare(
        'SELECT id FROM scenarios WHERE id=? AND line_account_id=?',
      )
        .bind(b.scenarioId, account)
        .first())
    )
      return c.json({ success: false, error: 'not_found' }, 404);
    if (
      b.stepId &&
      !(await c.env.DB.prepare(
        'SELECT id FROM scenario_steps WHERE id=? AND scenario_id=?',
      )
        .bind(b.stepId, b.scenarioId)
        .first())
    )
      return c.json({ success: false, error: 'not_found' }, 404);
    const now = new Date().toISOString(),
      expiry = new Date(Date.parse(now) + 30 * 86400000).toISOString(),
      key = c.req.param('key');
    // 版は保存ごとのUUID。削除・期限消去後に同じkeyを再作成しても古いタブの版は一致しない。
    const row =
      b.expectedVersion === 0
        ? await c.env.DB.prepare(
            `INSERT INTO scenario_edit_drafts(line_account_id,draft_key,content_json,scenario_id,step_id,version,updated_by,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING *`,
          )
            .bind(
              account,
              key,
              content,
              b.scenarioId ?? null,
              b.stepId ?? null,
              crypto.randomUUID(),
              c.get('staff').id,
              now,
              expiry,
            )
            .first<DraftRow>()
        : await c.env.DB.prepare(
            `UPDATE scenario_edit_drafts SET content_json=?,scenario_id=?,step_id=?,version=?,updated_by=?,updated_at=?,expires_at=? WHERE line_account_id=? AND draft_key=? AND version=? AND expires_at>? RETURNING *`,
          )
            .bind(
              content,
              b.scenarioId ?? null,
              b.stepId ?? null,
              crypto.randomUUID(),
              c.get('staff').id,
              now,
              expiry,
              account,
              key,
              b.expectedVersion,
              now,
            )
            .first<DraftRow>();
    if (!row) return c.json({ success: false, error: 'version_conflict' }, 409);
    return c.json(
      { success: true, data: serialize(row) },
      b.expectedVersion === 0 ? 201 : 200,
    );
  },
);
scenarioDrafts.delete(
  '/api/scenario-drafts/:key',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const account = await access(c);
    if (account instanceof Response) return account;
    const b = await c.req.json<{ expectedVersion: string }>().catch(() => null);
    if (!b || !validVersion(b.expectedVersion))
      return c.json(
        { success: false, error: 'expected_version_required' },
        400,
      );
    const result = await c.env.DB.prepare(
      'DELETE FROM scenario_edit_drafts WHERE line_account_id=? AND draft_key=? AND version=? AND expires_at>?',
    )
      .bind(
        account,
        c.req.param('key'),
        b.expectedVersion,
        new Date().toISOString(),
      )
      .run();
    return result.meta.changes
      ? c.json({ success: true })
      : c.json({ success: false, error: 'version_conflict' }, 409);
  },
);
export async function purgeExpiredScenarioDrafts(
  db: D1Database,
  now = new Date(),
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM scenario_edit_drafts WHERE expires_at<=?')
    .bind(now.toISOString())
    .run();
  return Number(result.meta.changes);
}
