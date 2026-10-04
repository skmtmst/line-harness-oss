/**
 * F-24 店ごとの自動で合わせるルール（予約枠・在庫 nGcY1）。
 * 1店1行（rt_store_auto_rules）。無ければ既定として読む。
 */

export type StoreAutoRuleAction = 'stop' | 'reduce';

export interface StoreAutoRules {
  autoAssignSeats: boolean
  countRemaining: boolean
  mergeDuplicates: boolean
  lowSeatThreshold: number
  lineAction: StoreAutoRuleAction
  walkinAction: StoreAutoRuleAction
  closeBanner: boolean
  notifyLine: boolean
  duplicateNotify: boolean
}

export const STORE_AUTO_RULE_DEFAULTS: StoreAutoRules = {
  autoAssignSeats: true,
  countRemaining: true,
  mergeDuplicates: true,
  lowSeatThreshold: 4,
  lineAction: 'stop',
  walkinAction: 'stop',
  closeBanner: true,
  notifyLine: true,
  duplicateNotify: true,
};

const toBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'number' ? value !== 0 : fallback;

function rowToRules(row: Record<string, unknown> | null): StoreAutoRules {
  if (!row) return { ...STORE_AUTO_RULE_DEFAULTS };
  const action = (value: unknown): StoreAutoRuleAction => (value === 'reduce' ? 'reduce' : 'stop');
  const threshold = typeof row.low_seat_threshold === 'number' && Number.isInteger(row.low_seat_threshold)
    ? Math.min(100, Math.max(0, row.low_seat_threshold))
    : STORE_AUTO_RULE_DEFAULTS.lowSeatThreshold;
  return {
    autoAssignSeats: toBool(row.auto_assign_seats, true),
    countRemaining: toBool(row.count_remaining, true),
    mergeDuplicates: toBool(row.merge_duplicates, true),
    lowSeatThreshold: threshold,
    lineAction: action(row.line_action),
    walkinAction: action(row.walkin_action),
    closeBanner: toBool(row.close_banner, true),
    notifyLine: toBool(row.notify_line, true),
    duplicateNotify: toBool(row.duplicate_notify, true),
  };
}

export async function getStoreAutoRules(db: D1Database, storeId: string): Promise<StoreAutoRules> {
  const row = await db.prepare('SELECT * FROM rt_store_auto_rules WHERE store_id = ?').bind(storeId).first<Record<string, unknown>>();
  return rowToRules(row);
}

export function validateStoreAutoRules(input: unknown): { ok: true; value: StoreAutoRules } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid_auto_rules' };
  const body = input as Record<string, unknown>;
  for (const key of ['autoAssignSeats', 'countRemaining', 'mergeDuplicates', 'closeBanner', 'notifyLine', 'duplicateNotify'] as const) {
    if (typeof body[key] !== 'boolean') return { ok: false, error: `invalid_${key}` };
  }
  if (!Number.isInteger(body.lowSeatThreshold) || (body.lowSeatThreshold as number) < 0 || (body.lowSeatThreshold as number) > 100) {
    return { ok: false, error: 'invalid_low_seat_threshold' };
  }
  for (const key of ['lineAction', 'walkinAction'] as const) {
    if (body[key] !== 'stop' && body[key] !== 'reduce') return { ok: false, error: `invalid_${key}` };
  }
  return {
    ok: true,
    value: {
      autoAssignSeats: body.autoAssignSeats as boolean,
      countRemaining: body.countRemaining as boolean,
      mergeDuplicates: body.mergeDuplicates as boolean,
      lowSeatThreshold: body.lowSeatThreshold as number,
      lineAction: body.lineAction as StoreAutoRuleAction,
      walkinAction: body.walkinAction as StoreAutoRuleAction,
      closeBanner: body.closeBanner as boolean,
      notifyLine: body.notifyLine as boolean,
      duplicateNotify: body.duplicateNotify as boolean,
    },
  };
}

export async function saveStoreAutoRules(db: D1Database, storeId: string, rules: StoreAutoRules): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO rt_store_auto_rules
    (store_id, auto_assign_seats, count_remaining, merge_duplicates, low_seat_threshold, line_action, walkin_action, close_banner, notify_line, duplicate_notify, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(store_id) DO UPDATE SET auto_assign_seats = excluded.auto_assign_seats, count_remaining = excluded.count_remaining,
    merge_duplicates = excluded.merge_duplicates, low_seat_threshold = excluded.low_seat_threshold, line_action = excluded.line_action,
    walkin_action = excluded.walkin_action, close_banner = excluded.close_banner, notify_line = excluded.notify_line,
    duplicate_notify = excluded.duplicate_notify, updated_at = excluded.updated_at`)
    .bind(storeId, rules.autoAssignSeats ? 1 : 0, rules.countRemaining ? 1 : 0, rules.mergeDuplicates ? 1 : 0,
      rules.lowSeatThreshold, rules.lineAction, rules.walkinAction, rules.closeBanner ? 1 : 0,
      rules.notifyLine ? 1 : 0, rules.duplicateNotify ? 1 : 0, now, now).run();
}
