

/** 受付条件として画面から送られてくる項目。 */
export interface MenuBookingRuleBody {
  concurrent_capacity?: unknown;
  booking_window_days?: unknown;
  cutoff_hours_before?: unknown;
  cancel_deadline_hours_before?: unknown;
  intake_question?: unknown;
}

export interface MenuBaseBody {
  name?: unknown;
  duration_minutes?: unknown;
  buffer_after_minutes?: unknown;
  sort_order?: unknown;
}

export function readMenuBase(
  body: MenuBaseBody,
): { ok: true; value: { name: string; durationMinutes: number; bufferAfterMinutes: number; sortOrder: number } }
  | { ok: false; error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'name must not be empty' };
  if (name.length > 200) return { ok: false, error: 'name must be 200 characters or fewer' };

  const durationMinutes = Number(body.duration_minutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1_440) {
    return { ok: false, error: 'duration_minutes must be an integer between 1 and 1440' };
  }
  const bufferAfterMinutes = body.buffer_after_minutes === undefined
    ? 0
    : Number(body.buffer_after_minutes);
  if (!Number.isInteger(bufferAfterMinutes) || bufferAfterMinutes < 0 || bufferAfterMinutes > 1_440) {
    return { ok: false, error: 'buffer_after_minutes must be an integer between 0 and 1440' };
  }
  const sortOrder = body.sort_order === undefined ? 0 : Number(body.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    return { ok: false, error: 'sort_order must be an integer between 0 and 1000000' };
  }
  return { ok: true, value: { name, durationMinutes, bufferAfterMinutes, sortOrder } };
}

/**
 * 受付条件を検証して、DBの列名で返す。送られた項目だけを含める。
 *
 * 上限を置いているのは、桁を間違えた値がそのまま保存されると
 * 「1年先まで予約できてしまう」「一度に999件受けてしまう」といった
 * 形で表に出てくるため。0 や負の値もここで弾く。
 */
export function readMenuBookingRules(
  b: MenuBookingRuleBody,
): { ok: true; value: Record<string, number | string | null> } | { ok: false; error: string } {
  const out: Record<string, number | string | null> = {};

  const positiveInt = (
    key: keyof MenuBookingRuleBody,
    column: string,
    max: number,
    { nullable }: { nullable: boolean },
  ): string | null => {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return null;
    const raw = b[key];
    if (raw === null || raw === '' || raw === undefined) {
      if (!nullable) return `${key} must not be empty`;
      out[column] = null;
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      return `${key} must be an integer between 1 and ${max}`;
    }
    out[column] = n;
    return null;
  };

  // 同時受付数だけは NOT NULL。空にはできず、最低1。
  const errors = [
    positiveInt('concurrent_capacity', 'concurrent_capacity', 100, { nullable: false }),
    positiveInt('booking_window_days', 'booking_window_days', 365, { nullable: true }),
    positiveInt('cutoff_hours_before', 'cutoff_hours_before', 24 * 30, { nullable: true }),
    positiveInt('cancel_deadline_hours_before', 'cancel_deadline_hours_before', 24 * 30, {
      nullable: true,
    }),
  ].filter((e): e is string => e !== null);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  if (Object.prototype.hasOwnProperty.call(b, 'intake_question')) {
    const raw = b.intake_question;
    if (raw === null || raw === '' || raw === undefined) {
      out.intake_question = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, error: 'intake_question must be a string' };
    } else if (raw.length > 200) {
      return { ok: false, error: 'intake_question must be 200 characters or fewer' };
    } else {
      out.intake_question = raw.trim();
    }
  }

  return { ok: true, value: out };
}
