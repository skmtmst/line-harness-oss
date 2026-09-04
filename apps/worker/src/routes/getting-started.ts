import { Hono } from 'hono';
import { hasFirstDeliveredMessage, resolveLineCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
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
    const accountId = c.req.query('account_id') ?? c.req.query('accountId') ?? null;
    if (accountId && !(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    const accounts = await c.env.DB.prepare(
      `SELECT id, is_active, channel_access_token, channel_access_token_encrypted,
              channel_secret, channel_secret_encrypted
         FROM line_accounts
        WHERE archived_at IS NULL`,
    ).all<AccountRow>();
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

    const tagCount = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM tags`).first<{ c: number }>();
    // 友だち情報欄はアカウントの絞り込みを別表（friend_field_scopes）で持つ。
    // 段2は「1つ以上あるか」だけなので、ここは全体の件数で足りる。
    const fieldCount = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM friend_fields`)
      .first<{ c: number }>();

    /*
      段3・段4。振り分けの版から見る。
      **公開されていない下書きを「公開した」と読まない。**
    */
    const published = accountId
      ? await c.env.DB.prepare(
          `SELECT definition_snapshot FROM friend_add_routing_versions
            WHERE line_account_id = ? AND status = 'published'
            ORDER BY version_number DESC LIMIT 1`,
        )
          .bind(accountId)
          .first<{ definition_snapshot: string }>()
      : null;
    const anyVersion = accountId
      ? await c.env.DB.prepare(
          `SELECT 1 AS hit FROM friend_add_routing_versions WHERE line_account_id = ? LIMIT 1`,
        )
          .bind(accountId)
          .first<{ hit: number }>()
      : null;

    let startedScenarioIds: string[] = [];
    if (published?.definition_snapshot) {
      try {
        const routing = JSON.parse(published.definition_snapshot) as {
          firstTime?: { scenarioId?: string | null };
          returning?: { scenarioId?: string | null };
        };
        startedScenarioIds = [routing.firstTime?.scenarioId, routing.returning?.scenarioId].filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        );
      } catch {
        startedScenarioIds = [];
      }
    }

    const scenarioTotal = await c.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM scenarios${accountId ? ' WHERE line_account_id = ? OR line_account_id IS NULL' : ''}`,
    )
      .bind(...(accountId ? [accountId] : []))
      .first<{ c: number }>();

    let scenarioFromFriendAdd = false;
    if (startedScenarioIds.length > 0) {
      const placeholders = startedScenarioIds.map(() => '?').join(', ');
      const hit = await c.env.DB.prepare(
        `SELECT 1 AS hit FROM scenarios WHERE is_active = 1 AND id IN (${placeholders}) LIMIT 1`,
      )
        .bind(...startedScenarioIds)
        .first<{ hit: number }>();
      scenarioFromFriendAdd = hit !== null;
    }

    const firstMessage = accountId ? await hasFirstDeliveredMessage(c.env.DB, accountId) : false;

    const steps = [
      {
        key: 'accounts',
        state: (usable > 0 ? 'done' : rows.length > 0 ? 'stalled' : 'todo') as StepState,
        /*
          **Webhook を確かめられなかったことを隠さない。** ここが空だと、
          段1が終わらない理由が運用者に分からない。
        */
        webhook: webhookChecks,
      },
      {
        key: 'attributes',
        state: ((tagCount?.c ?? 0) > 0 || (fieldCount?.c ?? 0) > 0 ? 'done' : 'todo') as StepState,
      },
      {
        key: 'friendAdd',
        state: (published ? 'done' : anyVersion ? 'stalled' : 'todo') as StepState,
      },
      {
        key: 'scenario',
        state: (scenarioFromFriendAdd
          ? 'done'
          : (scenarioTotal?.c ?? 0) > 0
            ? 'stalled'
            : 'todo') as StepState,
      },
      {
        key: 'firstMessage',
        state: (firstMessage ? 'done' : 'todo') as StepState,
      },
    ];

    return c.json({
      success: true,
      data: {
        steps,
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
