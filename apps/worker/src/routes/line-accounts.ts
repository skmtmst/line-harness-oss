import { Hono, type Context } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  getLineAccounts,
  getLineAccountListStats,
  getLineAccountById,
  getLineAccountCredentialHealth,
  createLineAccount,
  updateLineAccount,
  updateLineAccountFields,
  updateLineAccountOrder,
  deleteUncommittedLineAccount,
  getLineAccountArchiveBlockers,
  setDefaultLineAccount,
  archiveLineAccount,
  restoreLineAccount,
  LineAccountLifecycleError,
} from '@line-crm/db';
import type { LineAccount as DbLineAccount } from '@line-crm/db';
import { CredentialEncryptionKeyError } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import { fetchBotProfile } from '../lib/bot-profile.js';
import {
  detectFollowerImportCapability,
  getFollowerImportState,
  processFollowerImportStep,
  startFollowerImport,
} from '../services/follower-import.js';
import type { FollowerImportClient } from '../services/follower-import.js';
import {
  canAccessAllLineAccounts,
  getVisibleLineAccountScope,
  validateAccountHierarchy,
} from '../services/account-access.js';
import { copyLineAccountSettings, normalizeCopyItems } from '../services/account-copy.js';
import { IDENTITY_KEY_SQL } from '../lib/identity-key.js';
import { fetchLineMonthlyPlan } from '../services/line-monthly-plan.js';
import { fetchWebhookEndpointState } from '../services/line-webhook-state.js';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';

const lineAccounts = new Hono<Env>();

/**
 * 友だち数の上限と警告値を検証する。
 *
 * 警告値が上限を超えていたら弾く。超えた値は永久に鳴らないので、
 * 設定したつもりで一度も警告が出ない、という壊れ方をする。
 */
function readCapacity(
  body: { friendCapacity?: unknown; capacityWarnAt?: unknown },
  current: { friend_capacity: number | null; capacity_warn_at: number | null } | null,
): { ok: true; value: { friendCapacity?: number | null; capacityWarnAt?: number | null } } | { ok: false; error: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const out: { friendCapacity?: number | null; capacityWarnAt?: number | null } = {};

  const parse = (raw: unknown): number | null | 'invalid' => {
    if (raw === null || raw === '' || raw === undefined) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 100_000_000) return 'invalid';
    return n;
  };

  if (has('friendCapacity')) {
    const v = parse(body.friendCapacity);
    if (v === 'invalid') return { ok: false, error: 'friendCapacity must be a positive integer' };
    out.friendCapacity = v;
  }
  if (has('capacityWarnAt')) {
    const v = parse(body.capacityWarnAt);
    if (v === 'invalid') return { ok: false, error: 'capacityWarnAt must be a positive integer' };
    out.capacityWarnAt = v;
  }

  const effectiveCapacity =
    out.friendCapacity !== undefined ? out.friendCapacity : (current?.friend_capacity ?? null);
  const effectiveWarn =
    out.capacityWarnAt !== undefined ? out.capacityWarnAt : (current?.capacity_warn_at ?? null);
  if (effectiveCapacity != null && effectiveWarn != null && effectiveWarn > effectiveCapacity) {
    return { ok: false, error: 'capacityWarnAt must not exceed friendCapacity' };
  }
  return { ok: true, value: out };
}

function serializeLineAccount(row: DbLineAccount) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
    archivedAt: row.archived_at ?? null,
    country: row.country,
    role: row.role,
    displayOrder: row.display_order,
    // login_channel_id and liff_id are non-secret identifiers (visible in
    // LINE Developers console, embedded in public LIFF URLs). Safe to expose
    // in list responses so the admin UI can show "Login/LIFF configured?"
    // without a separate fetch.
    loginChannelId: row.login_channel_id,
    liffId: row.liff_id,
    ogSiteName: row.og_site_name,
    ogDefaultImageUrl: row.og_default_image_url,
    ogDefaultDescription: row.og_default_description,
    // 上限とアイコンは鍵ではない。閲覧のみの人にも見せる。
    friendCapacity: row.friend_capacity ?? null,
    capacityWarnAt: row.capacity_warn_at ?? null,
    iconUrl: row.icon_url ?? null,
    parentLineAccountId: row.parent_line_account_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    channelAccessTokenConfigured: Boolean(
      row.channel_access_token_encrypted || row.channel_access_token,
    ),
    channelAccessTokenLast4: row.channel_access_token_last4 ?? null,
    channelAccessTokenUpdatedAt: row.channel_access_token_updated_at ?? null,
    channelSecretConfigured: Boolean(row.channel_secret_encrypted || row.channel_secret),
    channelSecretLast4: row.channel_secret_last4 ?? null,
    channelSecretUpdatedAt: row.channel_secret_updated_at ?? null,
    loginChannelSecretConfigured: Boolean(row.login_channel_secret),
    loginChannelSecretLast4: row.login_channel_secret_last4 ?? null,
    loginChannelSecretUpdatedAt: row.login_channel_secret_updated_at ?? null,
  };
}

function serializeLineAccountFull(row: DbLineAccount) {
  // Credential values are deliberately never returned after persistence.
  // Owners rotate them by submitting a new value; the UI only sees whether
  // each credential is configured.
  return serializeLineAccount(row);
}

function lifecycleConflict(error: unknown): { success: false; error: string } | null {
  if (!(error instanceof LineAccountLifecycleError)) return null;
  return { success: false, error: error.code };
}

const LINE_LIVE_ACCOUNT_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// GET /api/line-accounts - list all. LINE live data is opt-in with ?live=1.
lineAccounts.get('/api/line-accounts', async (c) => {
  try {
    const db = c.env.DB;
    const items = (await getVisibleLineAccountScope(c.env.DB, c.get('staff'))).accounts;
    const statsByAccount = await getLineAccountListStats(db, items.map((item) => item.id));
    const serializeWithStats = (item: DbLineAccount) => ({
      ...serializeLineAccount(item),
      displayName: item.name,
      stats: statsByAccount[item.id] ?? {
        friendCount: 0,
        activeScenarios: 0,
        messagesThisMonth: 0,
      },
    });

    if (c.req.query('live') !== '1') {
      return c.json({
        success: true,
        data: items.map(serializeWithStats),
      });
    }
    const base = (c.env.WORKER_PUBLIC_URL || c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/$/, '');
    const expectedWebhookUrl = `${base}/webhook`;

    // 1アカウントにつき最大3接続を同時に開くため、2アカウントずつに抑える。
    // Workersの同時外向き接続上限6を越えない。
    const results = await mapWithConcurrency(
      items,
      LINE_LIVE_ACCOUNT_CONCURRENCY,
      async (item) => {
        const [profile, webhook, plan] = await Promise.all([
          fetchBotProfile(item.channel_access_token),
          fetchWebhookEndpointState(item.channel_access_token, expectedWebhookUrl),
          fetchLineMonthlyPlan(item.channel_access_token),
        ]);

        return {
          ...serializeWithStats(item),
          displayName: profile.displayName || item.name,
          pictureUrl: profile.pictureUrl || null,
          basicId: profile.basicId || null,
          webhook,
          plan,
        };
      },
    );
    return c.json({ success: true, data: results });
  } catch (err) {
    console.error('GET /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts/summary - visible accounts only
lineAccounts.get('/api/line-accounts/summary', async (c) => {
  try {
    const db = c.env.DB;
    const visibleActiveIds = (await getVisibleLineAccountScope(c.env.DB, c.get('staff'))).accounts
      .filter((item) => Boolean(item.is_active))
      .map((item) => item.id);
    if (visibleActiveIds.length === 0) {
      return c.json({ success: true, data: { uniqueFriendCount: 0 } });
    }
    const placeholders = visibleActiveIds.map(() => '?').join(', ');
    const row = await db.prepare(
      `SELECT COUNT(DISTINCT (${IDENTITY_KEY_SQL})) AS count
       FROM friends
       WHERE friends.is_following = 1
         AND friends.line_account_id IN (${placeholders})`,
    ).bind(...visibleActiveIds).first<{ count: number }>();
    return c.json({ success: true, data: { uniqueFriendCount: row?.count ?? 0 } });
  } catch (err) {
    console.error('GET /api/line-accounts/summary error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

type ConnectionVerification = {
  messagingApi: boolean;
  webhook: boolean;
  lineLogin: boolean;
  liff: boolean;
  webhookUrl: string | null;
  errors: string[];
};

async function verifyConnection(input: {
  channelAccessToken: string;
  loginChannelId: string;
  loginChannelSecret: string;
  liffId: string;
  expectedWebhookUrl: string | null;
}): Promise<ConnectionVerification> {
  const result: ConnectionVerification = {
    messagingApi: false,
    webhook: false,
    lineLogin: /^\d+$/.test(input.loginChannelId),
    liff: /^\d+-[A-Za-z0-9]+$/.test(input.liffId),
    webhookUrl: null,
    errors: [],
  };
  if (!input.loginChannelSecret.trim()) result.lineLogin = false;
  if (!result.lineLogin) result.errors.push('LINE LoginのChannel IDまたはChannel Secretを確認してください');
  if (!result.liff) result.errors.push('LIFF IDの形式を確認してください');

  const headers = { Authorization: `Bearer ${input.channelAccessToken}` };
  try {
    const botResponse = await fetch('https://api.line.me/v2/bot/info', { headers });
    result.messagingApi = botResponse.ok;
    if (!botResponse.ok) result.errors.push('Messaging APIのChannel Access Tokenを確認してください');
  } catch {
    result.errors.push('Messaging APIへ接続できませんでした');
  }

  if (result.messagingApi) {
    try {
      const endpointResponse = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      if (endpointResponse.ok) {
        const endpoint = await endpointResponse.json<{ endpoint?: string; active?: boolean }>();
        result.webhookUrl = endpoint.endpoint ?? null;
        const sameEndpoint = !input.expectedWebhookUrl || endpoint.endpoint === input.expectedWebhookUrl;
        if (endpoint.active && sameEndpoint) {
          const testResponse = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (testResponse.ok) {
            const tested = await testResponse.json<{ success?: boolean }>();
            result.webhook = tested.success === true;
          }
        }
      }
      if (!result.webhook) {
        result.errors.push('Webhook URLの一致・利用設定・接続テストを確認してください');
      }
    } catch {
      result.errors.push('Webhookの接続確認に失敗しました');
    }
  }
  return result;
}

// 保存前の接続確認。成功してもDBには一切書き込まない。
lineAccounts.post(
  '/api/line-accounts/verify-connection',
  requireRole('owner', 'admin'),
  async (c) => {
    const body = await c.req.json<{
      channelAccessToken?: string;
      loginChannelId?: string;
      loginChannelSecret?: string;
      liffId?: string;
    }>();
    const base = (c.env.WORKER_PUBLIC_URL || c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/$/, '');
    const data = await verifyConnection({
      channelAccessToken: body.channelAccessToken?.trim() ?? '',
      loginChannelId: body.loginChannelId?.trim() ?? '',
      loginChannelSecret: body.loginChannelSecret?.trim() ?? '',
      liffId: body.liffId?.trim() ?? '',
      expectedWebhookUrl: `${base}/webhook`,
    });
    return c.json({ success: true, data });
  },
);

// PUT /api/line-accounts/default - switch the organization default.
lineAccounts.put('/api/line-accounts/default', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: string }>();
    if (!body.accountId) {
      return c.json({ success: false, error: 'accountId is required' }, 400);
    }
    const account = await getLineAccountById(c.env.DB, body.accountId);
    if (!account || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [account.id])) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    if (account.archived_at) {
      return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
    }
    if (!account.is_active) {
      return c.json({ success: false, error: '停止中のLINEアカウントは既定にできません' }, 409);
    }
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    if ((account.tenant_id ?? DEFAULT_TENANT_ID) !== tenantId) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const updated = await setDefaultLineAccount(c.env.DB, account.id, tenantId);
    if (!updated?.is_default) {
      return c.json({ success: false, error: '既定のLINEアカウントを変更できませんでした' }, 409);
    }
    return c.json({ success: true, data: serializeLineAccount(updated) });
  } catch (err) {
    const conflict = lifecycleConflict(err);
    if (conflict) return c.json(conflict, 409);
    console.error('PUT /api/line-accounts/default error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function archiveAccountResponse(
  c: Context<Env>,
  defaultReason: string,
) {
  const id = c.req.param('id')!;
  const account = await getLineAccountById(c.env.DB, id);
  if (!account || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [id])) {
    return c.json({ success: false, error: 'LINE account not found' }, 404);
  }
  if (account.archived_at) {
    return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
  }
  const blockers = await getLineAccountArchiveBlockers(c.env.DB, id);
  if (blockers.length > 0) {
    return c.json({
      success: false,
      error: 'LINE_ACCOUNT_ARCHIVE_BLOCKED',
      details: { blockers },
    }, 409);
  }
  const body: { reason?: unknown } = await c.req
    .json<{ reason?: unknown }>()
    .catch(() => ({} as { reason?: unknown }));
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim()
    : defaultReason;
  if (reason.length > 500) {
    return c.json({ success: false, error: 'reason must be 500 characters or fewer' }, 422);
  }
  const archived = await archiveLineAccount(c.env.DB, id, c.get('staff').id, reason);
  if (!archived) return c.json({ success: false, error: 'LINE account not found' }, 404);
  return c.json({ success: true, data: serializeLineAccount(archived) });
}

lineAccounts.post('/api/line-accounts/:id/archive', requireRole('owner'), async (c) => {
  try {
    return await archiveAccountResponse(c, '運用者によるアーカイブ');
  } catch (err) {
    const conflict = lifecycleConflict(err);
    if (conflict) return c.json(conflict, 409);
    console.error('POST /api/line-accounts/:id/archive error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

lineAccounts.post('/api/line-accounts/:id/restore', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const account = await getLineAccountById(c.env.DB, id);
    if (!account || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [id])) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const restored = await restoreLineAccount(c.env.DB, id);
    return c.json({ success: true, data: serializeLineAccount(restored!) });
  } catch (err) {
    const conflict = lifecycleConflict(err);
    if (conflict) return c.json(conflict, 409);
    console.error('POST /api/line-accounts/:id/restore error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts/:id - get single without persisted secret values
lineAccounts.get('/api/line-accounts/:id', async (c) => {
  try {
    const account = await getLineAccountById(c.env.DB, c.req.param('id'));
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [account.id])) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    return c.json({ success: true, data: serializeLineAccount(account) });
  } catch (err) {
    console.error('GET /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Read-only owner diagnostic. Credential values never leave the DB layer.
lineAccounts.get(
  '/api/line-accounts/:id/credential-health',
  requireRole('owner'),
  async (c) => {
    try {
      const account = await getLineAccountById(c.env.DB, c.req.param('id'));
      if (!account) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [account.id])) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      const health = await getLineAccountCredentialHealth(
        c.env.DB,
        account.id,
      );
      if (!health) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      return c.json({ success: true, data: health });
    } catch {
      // Do not serialize the underlying error: crypto/runtime errors can contain
      // implementation details that are unnecessary for this diagnostic.
      console.error({ event: 'line_credential_health_check_failed' });
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// GET /api/line-accounts/:id/follower-insight - compare DB state with LINE official follower stats
lineAccounts.get('/api/line-accounts/:id/follower-insight', async (c) => {
  try {
    const date = c.req.query('date');
    if (!date || !/^\d{8}$/.test(date)) {
      return c.json({ success: false, error: 'date query is required in yyyyMMdd format' }, 400);
    }

    const account = await getLineAccountById(c.env.DB, c.req.param('id'));
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }

    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [account.id])) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const client = new LineClient(account.channel_access_token);
    const insight = await client.getFollowersInsight(date);
    return c.json({
      success: true,
      data: {
        lineAccountId: account.id,
        date,
        status: insight.status,
        followers: typeof insight.followers === 'number' ? insight.followers : null,
        targetedReaches: typeof insight.targetedReaches === 'number' ? insight.targetedReaches : null,
        blocks: typeof insight.blocks === 'number' ? insight.blocks : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('GET /api/line-accounts/:id/follower-insight error:', message);
    return c.json({ success: false, error: 'Failed to fetch LINE follower insight' }, 502);
  }
});

// Existing-follower migration is an explicit, persisted, one-time job.
// No cron polls LINE: connection/UI performs a one-item capability probe, then
// operator-approved step requests advance the D1 cursor until completion.
lineAccounts.get('/api/line-accounts/:id/follower-import', async (c) => {
  const account = await getLineAccountById(c.env.DB, c.req.param('id')!);
  if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [account.id])) {
    return c.json({ success: false, error: 'LINE account not found' }, 404);
  }
  const state = await getFollowerImportState(c.env.DB, account.id);
  return c.json({ success: true, data: state });
});

lineAccounts.post(
  '/api/line-accounts/:id/follower-import/detect',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const account = await getLineAccountById(c.env.DB, c.req.param('id')!);
      if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [account.id])) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      if (account.archived_at) {
        return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
      }
      const client = new LineClient(account.channel_access_token);
      const state = await detectFollowerImportCapability(
        c.env.DB,
        client as unknown as FollowerImportClient,
        account.id,
      );
      return c.json({ success: true, data: state });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('follower import capability detection error:', message);
      return c.json({ success: false, error: '利用可否の確認に失敗しました' }, 502);
    }
  },
);

lineAccounts.post(
  '/api/line-accounts/:id/follower-import/start',
  requireRole('owner', 'admin'),
  async (c) => {
    const account = await getLineAccountById(c.env.DB, c.req.param('id')!);
    if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [account.id])) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    if (account.archived_at) {
      return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
    }
    try {
      const state = await startFollowerImport(c.env.DB, account.id);
      return c.json({ success: true, data: state });
    } catch (err) {
      if (err instanceof Error && err.message === 'FOLLOWER_IMPORT_NOT_AVAILABLE') {
        return c.json({ success: false, error: 'このアカウントでは既存友だち取得を利用できません' }, 409);
      }
      throw err;
    }
  },
);

lineAccounts.post(
  '/api/line-accounts/:id/follower-import/step',
  requireRole('owner', 'admin'),
  async (c) => {
    const account = await getLineAccountById(c.env.DB, c.req.param('id')!);
    if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [account.id])) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    if (account.archived_at) {
      return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
    }
    const client = new LineClient(account.channel_access_token);
    const result = await processFollowerImportStep(
      c.env.DB,
      client as unknown as FollowerImportClient,
      account.id,
    );
    return c.json({ success: true, data: result });
  },
);

// Normalize optional string inputs from the UI:
//   undefined → undefined (caller skips the column)
//   null      → null      (explicit clear)
//   ""        → null      (UI cleared the field)
//   non-string → undefined (defensive: silently drop bad input)
//
// Defined here (and in PATCH below) rather than shared, because the create
// path treats undefined and "" identically (both "no value provided"), while
// the partial-update path needs to distinguish "field absent" (no change)
// from "field cleared" (set to null). Keep the helper local so future
// behavior changes don't accidentally couple the two paths.
function normalizeOptionalString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

// Pair-validate Login Channel ID / Secret. Required because the OAuth flow
// asymmetrically gates on the two columns:
//   /auth/line       — switches to account-specific client_id as soon as
//                      login_channel_id is set (regardless of secret)
//   /auth/callback   — only uses account-specific creds when BOTH are set
// → an account with id-only or secret-only ends up half-configured: looks
// fine in the list, breaks token exchange for new friend-add flows.
//
// Rule: within a single request, the two fields must end up consistent.
// "current" reflects the state already stored (used on update paths so the
// caller can leave the secret unchanged when only renaming the ID).
function validateLoginChannelPair(
  next: { loginChannelId?: string | null | undefined; loginChannelSecret?: string | null | undefined },
  current: { login_channel_id: string | null; login_channel_secret: string | null } | null,
): string | null {
  // Resolve the post-update state for each field.
  // undefined = "not in request" → keep current value
  // null/string = "explicit set"  → use as-is
  const finalId =
    next.loginChannelId === undefined
      ? current?.login_channel_id ?? null
      : next.loginChannelId;
  const finalSecret =
    next.loginChannelSecret === undefined
      ? current?.login_channel_secret ?? null
      : next.loginChannelSecret;

  const idSet = finalId !== null && finalId !== '';
  const secretSet = finalSecret !== null && finalSecret !== '';

  if (idSet !== secretSet) {
    return idSet
      ? 'loginChannelSecret must be provided when loginChannelId is set'
      : 'loginChannelId must be provided when loginChannelSecret is set';
  }
  return null;
}

// Reject duplicate login_channel_id / liff_id across accounts.
// /auth/callback and /api/liff/config both resolve the row with `.first()`
// after a `WHERE col = ?` lookup, so duplicates would silently bind events
// to whichever row D1 happens to return first. App-level check (no DB UNIQUE
// constraint) so we can tighten without a migration on a busy production DB.
async function checkUniqueLoginAndLiff(
  db: D1Database,
  values: { loginChannelId?: string | null | undefined; liffId?: string | null | undefined },
  excludeId: string | null,
): Promise<string | null> {
  // Only check fields we're explicitly setting to non-null.
  const checks: Array<{ column: string; value: string; label: string }> = [];
  if (typeof values.loginChannelId === 'string' && values.loginChannelId !== '') {
    checks.push({ column: 'login_channel_id', value: values.loginChannelId, label: 'loginChannelId' });
  }
  if (typeof values.liffId === 'string' && values.liffId !== '') {
    checks.push({ column: 'liff_id', value: values.liffId, label: 'liffId' });
  }
  for (const { column, value, label } of checks) {
    const row = excludeId
      ? await db
          .prepare(`SELECT id FROM line_accounts WHERE ${column} = ? AND id != ? LIMIT 1`)
          .bind(value, excludeId)
          .first<{ id: string }>()
      : await db
          .prepare(`SELECT id FROM line_accounts WHERE ${column} = ? LIMIT 1`)
          .bind(value)
          .first<{ id: string }>();
    if (row) {
      return `${label} '${value}' is already assigned to another account`;
    }
  }
  return null;
}

// POST /api/line-accounts - create
lineAccounts.post('/api/line-accounts', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      channelId: string;
      name: string;
      channelAccessToken: string;
      channelSecret: string;
      loginChannelId?: string | null;
      loginChannelSecret?: string | null;
      liffId?: string | null;
      ogSiteName?: string | null;
      ogDefaultImageUrl?: string | null;
      ogDefaultDescription?: string | null;
      copyFromAccountId?: string | null;
      copyItems?: unknown;
    }>();

    if (!body.channelId || !body.name || !body.channelAccessToken || !body.channelSecret) {
      return c.json(
        { success: false, error: 'channelId, name, channelAccessToken, and channelSecret are required' },
        400,
      );
    }

    // Optional fields: empty string from UI = "not provided" → store NULL.
    // Trim whitespace defensively (LINE IDs/secrets shouldn't have spaces;
    // accidental spaces from copy-paste would silently break OAuth otherwise).
    const loginChannelId = normalizeOptionalString(body.loginChannelId) ?? null;
    const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret) ?? null;
    const liffId = normalizeOptionalString(body.liffId) ?? null;

    const pairError = validateLoginChannelPair(
      { loginChannelId, loginChannelSecret },
      null,
    );
    if (pairError) return c.json({ success: false, error: pairError }, 400);
    if (!loginChannelId || !loginChannelSecret || !liffId) {
      return c.json({ success: false, error: 'LINE LoginとLIFFの設定は必須です' }, 400);
    }

    const dupError = await checkUniqueLoginAndLiff(c.env.DB, { loginChannelId, liffId }, null);
    if (dupError) return c.json({ success: false, error: dupError }, 409);

    const copyItems = normalizeCopyItems(body.copyItems);
    if (copyItems === null) return c.json({ success: false, error: 'コピー項目が正しくありません' }, 400);
    const copyFromAccountId = normalizeOptionalString(body.copyFromAccountId) ?? null;
    const visibleAccounts = (await getVisibleLineAccountScope(c.env.DB, c.get('staff'))).accounts;
    const currentStaff = c.get('staff');
    if (
      currentStaff.role === 'admin' &&
      currentStaff.assignedLineAccountId &&
      !currentStaff.canAccessDescendantAccounts
    ) {
      return c.json({ success: false, error: '他アカウント権限がないため追加できません' }, 403);
    }
    if (copyFromAccountId) {
      const source = visibleAccounts.find((item) => item.id === copyFromAccountId);
      if (!source) return c.json({ success: false, error: 'コピー元を選択できません' }, 404);
      if (!source.is_active || !source.login_channel_id || !source.liff_id) {
        return c.json({ success: false, error: '接続済みのアカウントだけコピー元に選べます' }, 400);
      }
      if (copyItems.length === 0) {
        return c.json({ success: false, error: 'コピーする項目を1つ以上選択してください' }, 400);
      }
    } else if (copyItems.length > 0) {
      return c.json({ success: false, error: 'コピー元を選択してください' }, 400);
    }

    const base = (c.env.WORKER_PUBLIC_URL || c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/$/, '');
    const verification = await verifyConnection({
      channelAccessToken: body.channelAccessToken.trim(),
      loginChannelId,
      loginChannelSecret,
      liffId,
      expectedWebhookUrl: `${base}/webhook`,
    });
    if (!verification.messagingApi || !verification.webhook || !verification.lineLogin || !verification.liff) {
      return c.json({ success: false, error: 'すべての接続確認を完了してください', details: { connection: verification.errors } }, 400);
    }

    const account = await createLineAccount(c.env.DB, {
      channelId: body.channelId,
      name: body.name,
      channelAccessToken: body.channelAccessToken,
      channelSecret: body.channelSecret,
      loginChannelId,
      loginChannelSecret,
      liffId,
      ogSiteName: normalizeOptionalString(body.ogSiteName) ?? null,
      ogDefaultImageUrl: normalizeOptionalString(body.ogDefaultImageUrl) ?? null,
      ogDefaultDescription: normalizeOptionalString(body.ogDefaultDescription) ?? null,
      tenantId: currentStaff.tenantId ?? DEFAULT_TENANT_ID,
    }, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);

    if (copyFromAccountId && copyItems.length > 0) {
      try {
        await copyLineAccountSettings(c.env.DB, copyFromAccountId, account.id, copyItems);
      } catch (copyError) {
        await deleteUncommittedLineAccount(c.env.DB, account.id);
        console.error('[line-accounts] account setting copy failed', copyError);
        return c.json({ success: false, error: '設定のコピーに失敗したため、アカウントは追加していません' }, 500);
      }
    }

    // One read-only request at connection time records whether this account
    // can use followers/ids. This never starts the migration and is non-fatal:
    // a temporary LINE outage must not roll back account registration.
    try {
      await detectFollowerImportCapability(
        c.env.DB,
        new LineClient(account.channel_access_token) as unknown as FollowerImportClient,
        account.id,
      );
    } catch (err) {
      console.error('[line-accounts] follower import capability probe failed', err);
    }

    return c.json({ success: true, data: serializeLineAccountFull(account) }, 201);
  } catch (err) {
    if (err instanceof CredentialEncryptionKeyError) {
      return c.json({ success: false, error: 'LINE資格情報の暗号鍵が未設定です' }, 503);
    }
    // D1 surfaces UNIQUE-constraint violations as a thrown error. Surface
    // those as 409 so idempotent callers (e.g. create-line-harness retry
    // loop) can treat "already registered" as a non-fatal success.
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(message)) {
      return c.json({ success: false, error: 'channelId already registered' }, 409);
    }
    console.error('POST /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Authorization split:
//   PUT  (credentials replace)                                       -> owner only
//   PATCH /:id   (metadata: country/role/is_active/display_order)    -> owner|admin
//   PATCH /order (display_order bulk reorder)                        -> owner|admin
// Rationale: PUT replaces channel_access_token / channel_secret which is high-risk
// (mistake or misuse can stop production). PATCH only edits display metadata that
// is operationally safe for admins to change without owner intervention.

// PATCH /api/line-accounts/order — bulk update display_order
// IMPORTANT: must be declared BEFORE /:id so Hono matches the literal "order" first.
lineAccounts.patch(
  '/api/line-accounts/hierarchy',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{
        relationships?: Array<{ id?: unknown; parentLineAccountId?: unknown }>;
      }>();
      if (!Array.isArray(body.relationships) || body.relationships.length === 0) {
        return c.json({ success: false, error: '変更するLINEアカウント構成がありません' }, 400);
      }
      const relationships: Array<{ id: string; parentLineAccountId: string | null }> = [];
      for (const item of body.relationships) {
        if (
          typeof item.id !== 'string' ||
          !(item.parentLineAccountId === null || typeof item.parentLineAccountId === 'string')
        ) {
          return c.json({ success: false, error: 'LINEアカウント構成の形式が正しくありません' }, 400);
        }
        relationships.push({ id: item.id, parentLineAccountId: item.parentLineAccountId });
      }

      const allAccounts = await getLineAccounts(c.env.DB);
      const visible = (await getVisibleLineAccountScope(c.env.DB, c.get('staff'))).accounts;
      const visibleIds = new Set(visible.map((account) => account.id));
      if (
        relationships.some(
          (item) =>
            !visibleIds.has(item.id) ||
            (item.parentLineAccountId !== null && !visibleIds.has(item.parentLineAccountId)),
        )
      ) {
        return c.json({ success: false, error: '権限のないLINEアカウントは変更できません' }, 403);
      }
      if (relationships.some((item) => {
        const target = allAccounts.find((account) => account.id === item.id);
        const parent = item.parentLineAccountId
          ? allAccounts.find((account) => account.id === item.parentLineAccountId)
          : null;
        return Boolean(target?.archived_at || parent?.archived_at);
      })) {
        return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
      }
      const hierarchyError = validateAccountHierarchy(allAccounts, relationships);
      if (hierarchyError) return c.json({ success: false, error: hierarchyError }, 400);

      await c.env.DB.batch(
        relationships.map((item) =>
          c.env.DB
            .prepare(
              `UPDATE line_accounts
               SET parent_line_account_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
               WHERE id = ?`,
            )
            .bind(item.parentLineAccountId, item.id),
        ),
      );
      return c.json({ success: true, data: relationships });
    } catch (err) {
      console.error('PATCH /api/line-accounts/hierarchy error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

lineAccounts.patch(
  '/api/line-accounts/order',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{
        ordered: Array<{ id: string; displayOrder: number }>;
      }>();

      if (!Array.isArray(body.ordered)) {
        return c.json({ success: false, error: 'ordered: array required' }, 400);
      }
      for (const item of body.ordered) {
        if (typeof item.id !== 'string' || typeof item.displayOrder !== 'number') {
          return c.json(
            { success: false, error: 'ordered[].id (string) and displayOrder (number) required' },
            400,
          );
        }
      }

      const visibleAccounts = (await getVisibleLineAccountScope(c.env.DB, c.get('staff'))).accounts;
      const visibleIds = new Set(visibleAccounts.map((item) => item.id));
      if (body.ordered.some((item) => !visibleIds.has(item.id))) {
        return c.json({ success: false, error: '権限のないLINEアカウントは並べ替えできません' }, 403);
      }
      const archivedIds = new Set(
        visibleAccounts
          .filter((account) => Boolean(account.archived_at))
          .map((account) => account.id),
      );
      if (body.ordered.some((item) => archivedIds.has(item.id))) {
        return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
      }

      await updateLineAccountOrder(c.env.DB, body.ordered);
      return c.json({ success: true });
    } catch (err) {
      const conflict = lifecycleConflict(err);
      if (conflict) return c.json(conflict, 409);
      console.error('PATCH /api/line-accounts/order error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// PATCH /api/line-accounts/:id — partial update of metadata + optional Login/LIFF wiring.
// Scope: name, isActive, country, role, loginChannelId, loginChannelSecret, liffId.
// Out-of-scope (use PUT instead): channelAccessToken, channelSecret — those are
// production-impacting credentials and require owner-only PUT.
//
// Why loginChannelSecret is allowed via PATCH (admin) but channelSecret isn't:
// rotating the LINE Login secret only breaks the auth/friend-add flow for new
// users (recoverable). Rotating the Messaging channelSecret breaks webhook
// verification for *all* incoming events from LINE → silent message loss, no
// observability until users complain. Different blast radius, different role.
lineAccounts.patch(
  '/api/line-accounts/:id',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const id = c.req.param('id')!;
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [id])) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      const currentAccount = await getLineAccountById(c.env.DB, id);
      if (!currentAccount) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      if (currentAccount.archived_at) {
        return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
      }
      const body = await c.req.json<{
        name?: string;
        isActive?: boolean;
        country?: string | null;
        role?: string | null;
        loginChannelId?: string | null;
        loginChannelSecret?: string | null;
        liffId?: string | null;
        ogSiteName?: string | null;
        ogDefaultImageUrl?: string | null;
        ogDefaultDescription?: string | null;
        friendCapacity?: unknown;
        capacityWarnAt?: unknown;
        iconUrl?: string | null;
      }>();
      if (body.isActive === false && currentAccount.is_default) {
        return c.json({ success: false, error: 'ACCOUNT_DEFAULT' }, 409);
      }

      // Normalize: trim non-empty strings; treat empty/whitespace-only as null.
      // Empty-string-from-UI represents "user cleared the field" — store as NULL,
      // not as empty string, so countryFlag() lookup degrades gracefully.
      const country = normalizeOptionalString(body.country);
      const role = normalizeOptionalString(body.role);
      const loginChannelId = normalizeOptionalString(body.loginChannelId);
      const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret);
      const liffId = normalizeOptionalString(body.liffId);
      const ogSiteName = normalizeOptionalString(body.ogSiteName);
      const ogDefaultImageUrl = normalizeOptionalString(body.ogDefaultImageUrl);
      const ogDefaultDescription = normalizeOptionalString(body.ogDefaultDescription);
      const iconUrl = normalizeOptionalString(body.iconUrl);

      // 警告値と上限の突き合わせには、送られていない側の現在値が要る。
      // 上限だけを下げたときに、既存の警告値が上限を超える場合があるため。
      const touchesCapacity =
        Object.prototype.hasOwnProperty.call(body, 'friendCapacity') ||
        Object.prototype.hasOwnProperty.call(body, 'capacityWarnAt');
      const capacity = readCapacity(
        body,
        touchesCapacity ? currentAccount : null,
      );
      if (!capacity.ok) return c.json({ success: false, error: capacity.error }, 400);

      // Pre-validate Login pair + uniqueness against the existing row so the
      // caller gets a clean error before we mutate. Skip the lookup entirely
      // if the request doesn't touch any of the fields we'd validate, to
      // avoid a wasted SELECT on the toggle-isActive hot path.
      //
      // The pair check only runs when the request itself touches Login
      // fields. That matters because the setup CLI (packages/create-line-
      // harness/.../setup.ts:646-665) persists `login_channel_id` without
      // `login_channel_secret` as a best-effort step, so accounts in the
      // wild can have a half-set Login pair. A LIFF-only dashboard save
      // shouldn't be blocked by that pre-existing inconsistency.
      const touchesLogin =
        loginChannelId !== undefined || loginChannelSecret !== undefined;
      const touchesLoginOrLiff = touchesLogin || liffId !== undefined;
      if (touchesLoginOrLiff) {
        if (touchesLogin) {
          const pairError = validateLoginChannelPair(
            { loginChannelId, loginChannelSecret },
            currentAccount,
          );
          if (pairError) return c.json({ success: false, error: pairError }, 400);
        }
        const dupError = await checkUniqueLoginAndLiff(
          c.env.DB,
          { loginChannelId, liffId },
          id,
        );
        if (dupError) return c.json({ success: false, error: dupError }, 409);
      }

      const touchesOg =
        ogSiteName !== undefined ||
        ogDefaultImageUrl !== undefined ||
        ogDefaultDescription !== undefined;

      const fieldsTouched =
        country !== undefined ||
        role !== undefined ||
        body.isActive !== undefined ||
        touchesLoginOrLiff ||
        touchesOg ||
        touchesCapacity ||
        iconUrl !== undefined;

      // Route to the fields helper when name is not being changed.
      if (body.name === undefined && fieldsTouched) {
        const updated = await updateLineAccountFields(c.env.DB, id, {
          country,
          role,
          isActive: body.isActive,
          loginChannelId,
          loginChannelSecret,
          liffId,
          ogSiteName,
          ogDefaultImageUrl,
          ogDefaultDescription,
          iconUrl,
          ...capacity.value,
        });
        if (!updated) return c.json({ success: false, error: 'not found' }, 404);
        return c.json({ success: true, data: serializeLineAccount(updated) });
      }

      // name is present — use the full updateLineAccount path
      const updated = await updateLineAccount(c.env.DB, id, {
        name: body.name,
        is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
        login_channel_id: loginChannelId,
        login_channel_secret: loginChannelSecret,
        liff_id: liffId,
        og_site_name: ogSiteName,
        og_default_image_url: ogDefaultImageUrl,
        og_default_description: ogDefaultDescription,
        icon_url: iconUrl,
        friend_capacity: capacity.value.friendCapacity,
        capacity_warn_at: capacity.value.capacityWarnAt,
      });
      if (!updated) return c.json({ success: false, error: 'LINE account not found' }, 404);
      return c.json({ success: true, data: serializeLineAccount(updated) });
    } catch (err) {
      const conflict = lifecycleConflict(err);
      if (conflict) return c.json(conflict, 409);
      console.error('PATCH /api/line-accounts/:id error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// PUT /api/line-accounts/:id - update
// Despite the verb, behaves as a partial update (only provided fields are
// touched). Kept on PUT + owner-only because it's the entry point for
// rotating Messaging credentials (channelAccessToken / channelSecret).
// Also accepts the metadata fields that PATCH handles so an owner can update
// "everything" in one call (e.g. AccountSettingsSection sends country/role
// through this same `api.lineAccounts.update` helper). Without this, country
// and role were silently dropped because PUT used to ignore them.
lineAccounts.put('/api/line-accounts/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [id])) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const currentAccount = await getLineAccountById(c.env.DB, id);
    if (!currentAccount) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    if (currentAccount.archived_at) {
      return c.json({ success: false, error: 'ACCOUNT_ARCHIVED' }, 409);
    }
    const body = await c.req.json<{
      name?: string;
      channelAccessToken?: string;
      channelSecret?: string;
      loginChannelId?: string | null;
      loginChannelSecret?: string | null;
      liffId?: string | null;
      isActive?: boolean;
      country?: string | null;
      role?: string | null;
      ogSiteName?: string | null;
      ogDefaultImageUrl?: string | null;
      ogDefaultDescription?: string | null;
    }>();
    if (body.isActive === false && currentAccount.is_default) {
      return c.json({ success: false, error: 'ACCOUNT_DEFAULT' }, 409);
    }

    const country = normalizeOptionalString(body.country);
    const role = normalizeOptionalString(body.role);
    const loginChannelId = normalizeOptionalString(body.loginChannelId);
    const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret);
    const liffId = normalizeOptionalString(body.liffId);
    const ogSiteName = normalizeOptionalString(body.ogSiteName);
    const ogDefaultImageUrl = normalizeOptionalString(body.ogDefaultImageUrl);
    const ogDefaultDescription = normalizeOptionalString(body.ogDefaultDescription);

    // Validate Login pair + uniqueness identically to PATCH. PUT is the
    // owner-only credential rotation endpoint, so the same correctness
    // guarantees should apply here.
    const putTouchesLogin =
      loginChannelId !== undefined || loginChannelSecret !== undefined;
    if (putTouchesLogin || liffId !== undefined) {
      if (putTouchesLogin) {
        const pairError = validateLoginChannelPair(
          { loginChannelId, loginChannelSecret },
          currentAccount,
        );
        if (pairError) return c.json({ success: false, error: pairError }, 400);
      }
      const dupError = await checkUniqueLoginAndLiff(
        c.env.DB,
        { loginChannelId, liffId },
        id,
      );
      if (dupError) return c.json({ success: false, error: dupError }, 409);
    }

    // Two-step update because metadata (country/role) lives on a separate
    // helper from the credentials/name path. Skip whichever step has nothing
    // to do so we don't bump updated_at gratuitously.
    const credentialsTouched =
      body.name !== undefined ||
      body.channelAccessToken !== undefined ||
      body.channelSecret !== undefined ||
      loginChannelId !== undefined ||
      loginChannelSecret !== undefined ||
      liffId !== undefined ||
      body.isActive !== undefined;

    let updated = credentialsTouched
      ? await updateLineAccount(c.env.DB, id, {
          name: body.name,
          channel_access_token: body.channelAccessToken,
          channel_secret: body.channelSecret,
          login_channel_id: loginChannelId,
          login_channel_secret: loginChannelSecret,
          liff_id: liffId,
          is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
        }, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY)
      : await getLineAccountById(c.env.DB, id);

    if (!updated) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }

    if (
      country !== undefined ||
      role !== undefined ||
      ogSiteName !== undefined ||
      ogDefaultImageUrl !== undefined ||
      ogDefaultDescription !== undefined
    ) {
      updated = await updateLineAccountFields(c.env.DB, id, {
        country,
        role,
        ogSiteName,
        ogDefaultImageUrl,
        ogDefaultDescription,
      });
      if (!updated) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
    }

    return c.json({ success: true, data: serializeLineAccountFull(updated) });
  } catch (err) {
    const conflict = lifecycleConflict(err);
    if (conflict) return c.json(conflict, 409);
    if (err instanceof CredentialEncryptionKeyError) {
      return c.json({ success: false, error: 'LINE資格情報の暗号鍵が未設定です' }, 503);
    }
    console.error('PUT /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/line-accounts/:id - backward-compatible archive endpoint.
lineAccounts.delete('/api/line-accounts/:id', requireRole('owner'), async (c) => {
  try {
    return await archiveAccountResponse(c, '旧DELETE APIからのアーカイブ');
  } catch (err) {
    const conflict = lifecycleConflict(err);
    if (conflict) return c.json(conflict, 409);
    console.error('DELETE /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { lineAccounts };
