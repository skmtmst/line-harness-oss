export type BookingOperationKind =
  | 'confirmation_line'
  | 'google_calendar'
  | 'conversion'
  | 'mileage'
  | 'automation';

export type BookingOperationStatus =
  | 'queued'
  | 'succeeded'
  | 'skipped'
  | 'retry_wait'
  | 'permanent_failed'
  | 'cancelled';

export interface BookingOperationRun {
  id: string;
  kind: BookingOperationKind;
  status: BookingOperationStatus;
  scheduledAt: string | null;
  completedAt: string | null;
  openedAt: string | null;
  result: Record<string, unknown>;
  errorCode: string | null;
}

interface RunRow {
  id: string;
  kind: BookingOperationKind;
  status: BookingOperationStatus;
  scheduled_at: string | null;
  completed_at: string | null;
  opened_at: string | null;
  result_json: string;
  error_code: string | null;
}

function parseResult(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function queueBookingOperation(
  db: D1Database,
  input: {
    bookingId: string;
    lineAccountId: string;
    kind: BookingOperationKind;
    idempotencyKey: string;
    scheduledAt?: string | null;
    result?: Record<string, unknown>;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT OR IGNORE INTO booking_operation_runs
       (id, booking_id, line_account_id, kind, status, scheduled_at, result_json, idempotency_key)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
  ).bind(
    id,
    input.bookingId,
    input.lineAccountId,
    input.kind,
    input.scheduledAt ?? null,
    JSON.stringify(input.result ?? {}),
    input.idempotencyKey,
  ).run();
  const row = await db.prepare(
    `SELECT id FROM booking_operation_runs
      WHERE line_account_id = ? AND idempotency_key = ?`,
  ).bind(input.lineAccountId, input.idempotencyKey).first<{ id: string }>();
  return row?.id ?? id;
}

export async function finishBookingOperation(
  db: D1Database,
  input: {
    id: string;
    status: Exclude<BookingOperationStatus, 'queued'>;
    completedAt: string;
    result?: Record<string, unknown>;
    errorCode?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE booking_operation_runs
        SET status = ?, completed_at = ?, result_json = ?, error_code = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(
    input.status,
    input.completedAt,
    JSON.stringify(input.result ?? {}),
    input.errorCode ?? null,
    input.completedAt,
    input.id,
  ).run();
}

export async function findBookingOperation(
  db: D1Database,
  input: { lineAccountId: string; idempotencyKey: string },
): Promise<{ id: string; status: BookingOperationStatus } | null> {
  return db.prepare(
    `SELECT id, status FROM booking_operation_runs
      WHERE line_account_id = ? AND idempotency_key = ?`,
  ).bind(input.lineAccountId, input.idempotencyKey).first<{
    id: string;
    status: BookingOperationStatus;
  }>();
}

export async function listBookingOperations(
  db: D1Database,
  input: { bookingId: string; lineAccountId: string },
): Promise<BookingOperationRun[]> {
  const rows = await db.prepare(
    `SELECT id, kind, status, scheduled_at, completed_at, opened_at, result_json, error_code
       FROM booking_operation_runs
      WHERE booking_id = ? AND line_account_id = ?
      ORDER BY created_at ASC, id ASC`,
  ).bind(input.bookingId, input.lineAccountId).all<RunRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    scheduledAt: row.scheduled_at,
    completedAt: row.completed_at,
    openedAt: row.opened_at,
    result: parseResult(row.result_json),
    errorCode: row.error_code,
  }));
}
