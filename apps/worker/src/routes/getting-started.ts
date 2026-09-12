import { Hono } from 'hono';
import { hasFirstDeliveredMessage, resolveLineCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { expectedWebhookUrl, fetchWebhookEndpoint } from '../lib/webhook-endpoint.js';

/**
 * はじめの設定の順路。設計 ★V6 34-1（`RAW35`）。台帳 #134。
 *
 * **画面を開いたかではなく、実際に作られたもので判定する。**
 * 訪問の記録は持たない。毎回いまの中身を数え、キャッシュもしない
 * （要件 v6-34 §6-1）。
 */
const gettingStarted = new Hono<Env>();

export type StepState = 'done' | 'stalled' | 'todo' | 'forbidden' | 'unknown';

const STEP_HREFS = {
  accounts: '/accounts',
  attributes: '/tags?tab=tags',
  friendAdd: '/friend-add-settings',
  scenario: '/scenarios',
  firstMessage: '/',
} as const;

const STEP_PERMISSIONS: Record<keyof typeof STEP_HREFS, string[]> = {
  accounts: ['/accounts', 'account.definition.edit'],
  attributes: ['/tags', 'tag.definition.edit'],
  friendAdd: ['/friend-add-settings', 'friend_add.definition.edit'],
  scenario: ['/scenarios', 'scenario.definition.edit'],
  firstMessage: ['/chats', 'message.test.send'],
};

function canAdvance(staff: AuthenticatedStaff | undefined, key: keyof typeof STEP_HREFS) {
  if (!staff) return false;
  if (staff.role === 'owner' || staff.role === 'admin') return true;
  return STEP_PERMISSIONS[key].some((permission) => staff.permissionKeys?.includes(permission));
}

function withAccess(
  staff: AuthenticatedStaff | undefined,
  key: keyof typeof STEP_HREFS,
  state: StepState,
  reason?: string | null,
) {
  const allowed = canAdvance(staff, key);
  return {
    key,
    state: state === 'done' || allowed ? state : 'forbidden' as StepState,
    href: allowed ? STEP_HREFS[key] : null,
    reason: allowed ? reason ?? null : '管理者に依頼してください',
  };
}

interface AccountRow {
  id: string;
  is_active: number;
  channel_access_token: string | null;
  channel_access_token_encrypted: string | null;
  channel_secret: string | null;
  channel_secret_encrypted: string | null;
}

gettingStarted.get('/api/getting-started', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff');
    const accountId = c.req.query('account_id') ?? c.req.query('accountId') ?? null;
    const visibleScope = await getVisibleLineAccountScope(c.env.DB, staff);
    if (accountId && !visibleScope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    const accountIds = accountId ? [accountId] : visibleScope.allowedAccountIds;
    const accounts = accountIds.length > 0 ? await c.env.DB.prepare(
      `SELECT id, is_active, channel_access_token, channel_access_token_encrypted,
              channel_secret, channel_secret_encrypted
         FROM line_accounts
        WHERE archived_at IS NULL AND id IN (${accountIds.map(() => '?').join(', ')})`,
    ).bind(...accountIds).all<AccountRow>() : { results: [] as AccountRow[] };
    const rows = accounts.results;

    /*
      段1。**3つとも揃って初めて「終わり」。**
      稼働中で、Webhook が合っていて、シークレットが確かめられている。
      Webhook は LINE に問い合わせて確かめる。**読めなかったものを
      「合っている」とも「登録されていない」とも言わない。**
    */
    const expected = expectedWebhookUrl(c.env.WORKER_URL ?? new URL(c.req.url).origin);
    const webhookChecks = await Promise.all(
      rows.map(async (row) => {
        if (row.is_active !== 1) return { id: row.id, status: 'unknown' as const };
        const hasSecret = Boolean(row.channel_secret || row.channel_secret_encrypted);
        if (!hasSecret) return { id: row.id, status: 'unknown' as const };
        try {
          const token = await resolveLineCredential(
            row.channel_access_token_encrypted,
            row.channel_access_token,
            { lineAccountId: row.id, field: 'channel_access_token' },
          );
          if (!token) return { id: row.id, status: 'unknown' as const };
          const check = await fetchWebhookEndpoint(token, expected);
          return { id: row.id, status: check.status };
        } catch {
          return { id: row.id, status: 'unknown' as const };
        }
      }),
    );
    const usable = webhookChecks.filter((w) => w.status === 'matched').length;

    const tagCount = accountId ? await c.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM tags
        WHERE line_account_id = ? AND COALESCE(status, 'active') != 'archived'`,
    ).bind(accountId).first<{ c: number }>() : null;
    const fieldCount = accountId ? await c.env.DB.prepare(
      `SELECT COUNT(*) AS c
         FROM friend_fields f
         JOIN friend_field_scopes s ON s.field_id = f.id
        WHERE s.line_account_id = ? AND f.status != 'archived'`,
    ).bind(accountId).first<{ c: number }>() : null;

    /*
      段3・段4。振り分けの版から見る。
      **公開されていない下書きを「公開した」と読まない。**
    */
    const ruleRows = accountId
      ? await c.env.DB.prepare(
          `SELECT r.is_unknown_route_fallback, v.definition_snapshot
             FROM friend_add_rules r
             JOIN friend_add_rule_versions v ON v.rule_id = r.id
            WHERE r.line_account_id = ? AND r.status = 'published'
              AND r.archived_at IS NULL AND v.status = 'published'`,
        )
          .bind(accountId)
          .all<{ is_unknown_route_fallback: number; definition_snapshot: string }>()
      : { results: [] as Array<{ is_unknown_route_fallback: number; definition_snapshot: string }> };
    const anyRule = accountId
      ? await c.env.DB.prepare(
          `SELECT 1 AS hit FROM friend_add_rules
            WHERE line_account_id = ? AND archived_at IS NULL LIMIT 1`,
        )
          .bind(accountId)
          .first<{ hit: number }>()
      : null;

    let startedScenarioIds: string[] = [];
    for (const rule of ruleRows.results) {
      try {
        const definition = JSON.parse(rule.definition_snapshot) as {
          scenarioId?: string | null;
          actions?: Array<{ type?: string; scenarioId?: string; targetId?: string }>;
        };
        const actionIds = (definition.actions ?? [])
          .filter((action) => action.type === 'start_scenario')
          .map((action) => action.scenarioId ?? action.targetId);
        startedScenarioIds.push(definition.scenarioId ?? '', ...actionIds.filter(Boolean) as string[]);
      } catch {
        // 壊れた公開版を「設定済み」にしない。ほかの正常なルールは判定を続ける。
      }
    }
    startedScenarioIds = [...new Set(startedScenarioIds.filter(Boolean))];

    const scenarioTotal = await c.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM scenarios${accountId ? ' WHERE line_account_id = ?' : ' WHERE 1 = 0'}`,
    )
      .bind(...(accountId ? [accountId] : []))
      .first<{ c: number }>();

    let scenarioFromFriendAdd = false;
    if (startedScenarioIds.length > 0) {
      const placeholders = startedScenarioIds.map(() => '?').join(', ');
      const hit = await c.env.DB.prepare(
        `SELECT 1 AS hit FROM scenarios
          WHERE line_account_id = ? AND is_active = 1 AND id IN (${placeholders}) LIMIT 1`,
      )
        .bind(accountId, ...startedScenarioIds)
        .first<{ hit: number }>();
      scenarioFromFriendAdd = hit !== null;
    }

    const firstMessage = accountId ? await hasFirstDeliveredMessage(c.env.DB, accountId) : false;

    const hasPublishedRule = ruleRows.results.length > 0;
    const hasFallbackRule = ruleRows.results.some((row) => row.is_unknown_route_fallback === 1);
    const steps = [
      {
        ...withAccess(staff, 'accounts', usable > 0 ? 'done' : rows.length > 0 ? 'stalled' : 'todo',
          rows.length > 0 && usable === 0 ? 'Webhookまたはシークレットを確認してください' : null),
        /*
          **Webhook を確かめられなかったことを隠さない。** ここが空だと、
          段1が終わらない理由が運用者に分からない。
        */
        webhook: webhookChecks,
      },
      withAccess(staff, 'attributes',
        (tagCount?.c ?? 0) > 0 || (fieldCount?.c ?? 0) > 0 ? 'done' : 'todo'),
      withAccess(staff, 'friendAdd',
        hasPublishedRule && hasFallbackRule ? 'done' : anyRule ? 'stalled' : 'todo',
        hasPublishedRule && !hasFallbackRule ? 'どの条件にも当たらない人の受け皿がありません' : null),
      withAccess(staff, 'scenario', scenarioFromFriendAdd
          ? 'done'
          : (scenarioTotal?.c ?? 0) > 0
            ? 'stalled'
            : 'todo'),
      withAccess(staff, 'firstMessage', firstMessage ? 'done' : 'todo'),
    ];

    return c.json({
      success: true,
      data: {
        steps,
        accountId,
        doneCount: steps.filter((s) => s.state === 'done').length,
        total: steps.length,
        /** 全部終わったら、ダッシュボードの帯を出さない。 */
        allDone: steps.every((s) => s.state === 'done'),
      },
    });
  } catch (err) {
    console.error('GET /api/getting-started error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { gettingStarted };
