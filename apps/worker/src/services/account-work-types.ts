// Reserved for a separately provisioned producer invocation; not enabled by code deployment.
export const ACCOUNT_WORK_CRON = '*/2 * * * *';

export const ACCOUNT_WORK_TASKS = ['health', 'analytics', 'broadcast', 'calendar'] as const;
export type AccountWorkTask = (typeof ACCOUNT_WORK_TASKS)[number];

/** Queue payloads carry routing identifiers, never credentials or customer content. */
export type AccountWorkMessage = {
  kind: 'account_work';
  task: AccountWorkTask;
  accountId: string;
  windowStartedAt: string;
  sequence: number;
};

export const ACCOUNT_WORK_WINDOW_MS = 5 * 60_000;
export const ACCOUNT_WORK_MAX_CONTINUATIONS = 20;

export function isAccountWorkMessage(value: unknown): value is AccountWorkMessage {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AccountWorkMessage>;
  return row.kind === 'account_work'
    && ACCOUNT_WORK_TASKS.includes(row.task as AccountWorkTask)
    && typeof row.accountId === 'string' && row.accountId.length > 0 && row.accountId.length <= 128
    && typeof row.windowStartedAt === 'string' && Number.isFinite(Date.parse(row.windowStartedAt))
    && new Date(row.windowStartedAt).toISOString() === row.windowStartedAt
    && Number.isInteger(row.sequence) && row.sequence! >= 0 && row.sequence! <= ACCOUNT_WORK_MAX_CONTINUATIONS;
}
