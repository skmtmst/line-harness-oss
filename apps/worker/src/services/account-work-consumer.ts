import { getLineAccountById, isLineAccountTenantActive } from '@line-crm/db';
import type { WorkerBindings } from '../worker-bindings.js';
import { withScheduledWorkLease } from './scheduled-work-lease.js';
import { isAccountWorkMessage, ACCOUNT_WORK_MAX_CONTINUATIONS, type AccountWorkMessage } from './account-work-types.js';

type CompletedWork = { windowStartedAt: string; sequence: number };

/** Leave room for an orphaned 20-minute lease to expire before spending another retry. */
export class AccountWorkBusyError extends Error {
  readonly retryDelaySeconds = 21 * 60;
  constructor() {
    super('account_work_busy');
    this.name = 'AccountWorkBusyError';
  }
}

function parseCompleted(value: string | undefined): CompletedWork | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CompletedWork;
    return typeof parsed.windowStartedAt === 'string' && Number.isFinite(Date.parse(parsed.windowStartedAt))
      && Number.isInteger(parsed.sequence) ? parsed : null;
  } catch { return null; }
}

async function executeWork(env: WorkerBindings, message: AccountWorkMessage): Promise<number | null> {
  // Non-delivery jobs must not depend on decrypting an unrelated LINE secret.
  const account = await env.DB.prepare('SELECT id,is_active,archived_at,timezone FROM line_accounts WHERE id=?')
    .bind(message.accountId).first<{id:string;is_active:number;archived_at:string|null;timezone:string}>();
  if (!account || account.is_active !== 1 || account.archived_at || !await isLineAccountTenantActive(env.DB, account.id)) return null;
  const now = new Date(message.windowStartedAt);
  switch (message.task) {
    case 'health': {
      const { runOperationHealthChecks } = await import('./operations-health.js');
      const result = await runOperationHealthChecks(env.DB, {
        lineAccountId: account.id, source: 'scheduled', now: new Date().toISOString(),
        deps: { r2: env.IMAGES, queue: env.ACCOUNT_WORK_QUEUE, credentialEncryptionKey: env.LINE_CREDENTIAL_ENCRYPTION_KEY },
      });
      if (result.run.status !== 'completed') throw new Error('account_health_incomplete');
      return null;
    }
    case 'analytics': {
      const { refreshAccountAnalyticsProjection } = await import('./analytics-projection.js');
      const result = await refreshAccountAnalyticsProjection(env.DB, account, now);
      if (result.failed) throw new Error('account_projection_failed');
      return result.inProgress > 0 ? 1 : null;
    }
    case 'calendar': {
      const { refreshCalendarBusyCaches } = await import('../features/booking/booking-calendar-settings/index.js');
      const result = await refreshCalendarBusyCaches(env.DB, {
        email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      }, new Date(), { accountId: account.id, attemptedBefore: message.windowStartedAt });
      return result.hasMore && result.processed > 0 ? 1 : null;
    }
    case 'broadcast': {
      const credentials = await getLineAccountById(env.DB, account.id, env.LINE_CREDENTIAL_ENCRYPTION_KEY);
      if (!credentials || credentials.is_active !== 1 || credentials.archived_at) return null;
      // The token refresher runs in a different invocation. Wait for it rather
      // than recording delivery failures with credentials already due to expire.
      if (credentials.token_expires_at) {
        const expiresAt = Date.parse(credentials.token_expires_at);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
          throw new Error('account_work_credentials_not_ready');
        }
      }
      const { processQueuedBroadcasts } = await import('../features/broadcasts/broadcast/index.js');
      const { LineClient } = await import('@line-crm/line-sdk');
      const result = await processQueuedBroadcasts(env.DB, new LineClient(credentials.channel_access_token), env.WORKER_URL, { accountId: account.id, credentialEncryptionKey: env.LINE_CREDENTIAL_ENCRYPTION_KEY });
      // A paused/blocked account is retried by the next scheduled window instead
      // of creating an endless continuation loop that crowds out other accounts.
      if (!result.hasMore || result.retryDeferred) return null;
      const delay = result.nextDelaySeconds ?? 0;
      if (!Number.isFinite(delay) || delay < 0) throw new Error('account_work_delay_invalid');
      return result.acceptedRecipients > 0 || delay > 0 ? Math.max(1, Math.min(86400, Math.ceil(delay))) : null;
    }
  }
}

/** One account/task per invocation; successful duplicate deliveries are acknowledged without rerunning. */
export async function consumeAccountWork(env: WorkerBindings, body: unknown): Promise<void> {
  if (!env.ACCOUNT_WORK_QUEUE) throw new Error('account_work_queue_not_configured');
  if (!isAccountWorkMessage(body)) throw new Error('invalid_account_work_message');
  const key = `account-work-completed:${body.task}:${body.accountId}`;
  const outcome = await withScheduledWorkLease(env.DB, `account-work:${body.task}:${body.accountId}`, async lease => {
    const row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?')
      .bind(key).first<{ value: string }>();
    const completed = parseCompleted(row?.value);
    if (completed && (completed.windowStartedAt > body.windowStartedAt
      || (completed.windowStartedAt === body.windowStartedAt && completed.sequence >= body.sequence))) return;
    if (!await lease.renew()) throw new Error('account_work_lease_lost');
    const delaySeconds = await executeWork(env, body);
    if (!await lease.renew()) throw new Error('account_work_lease_lost');
    if (delaySeconds !== null && body.sequence < ACCOUNT_WORK_MAX_CONTINUATIONS) {
      await env.ACCOUNT_WORK_QUEUE!.send({ ...body, sequence: body.sequence + 1 }, { delaySeconds });
    }
    // Persist after enqueue, so an enqueue failure retries the durable business
    // cursor rather than silently losing its continuation. Business delivery
    // claims remain the source of truth across that at-least-once boundary.
    await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_by, updated_at)
      VALUES (?, ?, 'account-work', ?) ON CONFLICT(key) DO UPDATE SET
      value=excluded.value, updated_at=excluded.updated_at`)
      .bind(key, JSON.stringify({ windowStartedAt: body.windowStartedAt, sequence: body.sequence }), new Date().toISOString()).run();
  });
  if (!outcome.acquired) throw new AccountWorkBusyError();
}
