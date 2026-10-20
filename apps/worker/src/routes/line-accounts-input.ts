/**
 * 友だち数の上限と警告値を検証する。
 *
 * 警告値が上限を超えていたら弾く。超えた値は永久に鳴らないので、
 * 設定したつもりで一度も警告が出ない、という壊れ方をする。
 */
export function readCapacity(
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

// Normalize optional string inputs from the UI:
//   undefined → undefined (caller skips the column)
//   null      → null      (explicit clear)
//   ""        → null      (UI cleared the field)
//   non-string → undefined (defensive: silently drop bad input)
//
// The create path treats undefined and "" identically (both "no value provided"), while
// the partial-update path needs to distinguish "field absent" (no change)
// from "field cleared" (set to null). Keep the helper local so future
// behavior changes don't accidentally couple unrelated features.
export function normalizeOptionalString(v: unknown): string | null | undefined {
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
export function validateLoginChannelPair(
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
