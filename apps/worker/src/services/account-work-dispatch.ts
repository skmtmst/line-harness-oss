import type { WorkerBindings } from '../worker-bindings.js';
import { withScheduledWorkLease, SCHEDULED_WORK_BUDGET_MS } from './scheduled-work-lease.js';
import { ACCOUNT_WORK_TASKS, ACCOUNT_WORK_WINDOW_MS, type AccountWorkMessage } from './account-work-types.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const CHECKPOINT_KEY = 'account-work-dispatch';

type DispatchCheckpoint = { windowStartedAt: string; cursor: string; completed: boolean };

function checkpoint(value: string | undefined): DispatchCheckpoint | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as DispatchCheckpoint;
    return typeof parsed.windowStartedAt === 'string' && Number.isFinite(Date.parse(parsed.windowStartedAt))
      && typeof parsed.cursor === 'string' && typeof parsed.completed === 'boolean' ? parsed : null;
  } catch { return null; }
}

/** Enqueue pages, checkpoint only after acceptance, and resume a failed page on the next tick. */
export async function dispatchAccountWork(
  env: WorkerBindings,
  scheduledTime: number,
  clock: () => number = Date.now,
): Promise<{ enabled: boolean; accounts: number; completed: boolean }> {
  const queue = env.ACCOUNT_WORK_QUEUE;
  if (!queue) return { enabled: false, accounts: 0, completed: false };
  const windowStartedAt = new Date(Math.floor(scheduledTime / ACCOUNT_WORK_WINDOW_MS) * ACCOUNT_WORK_WINDOW_MS).toISOString();
  const outcome = await withScheduledWorkLease(env.DB, 'account-work-dispatch', async lease => {
    const row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?')
      .bind(CHECKPOINT_KEY).first<{ value: string }>();
    const previous = checkpoint(row?.value);
    // Finish an interrupted older sweep before opening a new one. This prevents
    // accounts at the end of the directory from being starved by repeated failures.
    const state: DispatchCheckpoint = previous && !previous.completed ? previous
      : previous && previous.windowStartedAt >= windowStartedAt ? previous
        : { windowStartedAt, cursor: '', completed: false };
    if (state.completed) return { enabled: true, accounts: 0, completed: true };
    const started = clock();
    let accounts = 0;
    for (let page = 0; page < MAX_PAGES && clock() - started < SCHEDULED_WORK_BUDGET_MS; page++) {
      if (!await lease.renew()) throw new Error('account_work_dispatch_lease_lost');
      const rows = await env.DB.prepare(
        'SELECT id FROM line_accounts WHERE is_active = 1 AND id > ? ORDER BY id LIMIT ?',
      ).bind(state.cursor, PAGE_SIZE).all<{ id: string }>();
      const ids = rows.results ?? [];
      // Each sendBatch is at most 100 messages and about 25 KB at the ID limit.
      for (const task of ACCOUNT_WORK_TASKS) {
        if (ids.length === 0) break;
        await queue.sendBatch(ids.map(account => ({ body: {
          kind: 'account_work', task, accountId: account.id,
          windowStartedAt: state.windowStartedAt, sequence: 0,
        } satisfies AccountWorkMessage })));
      }
      if (!await lease.renew()) throw new Error('account_work_dispatch_lease_lost');
      state.cursor = ids.at(-1)?.id ?? state.cursor;
      state.completed = ids.length < PAGE_SIZE;
      await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_by, updated_at)
        VALUES (?, ?, 'account-work', ?) ON CONFLICT(key) DO UPDATE SET
        value=excluded.value, updated_at=excluded.updated_at`)
        .bind(CHECKPOINT_KEY, JSON.stringify(state), new Date(clock()).toISOString()).run();
      accounts += ids.length;
      if (state.completed) break;
    }
    return { enabled: true, accounts, completed: state.completed };
  }, clock);
  return outcome.acquired ? outcome.value : { enabled: true, accounts: 0, completed: false };
}
