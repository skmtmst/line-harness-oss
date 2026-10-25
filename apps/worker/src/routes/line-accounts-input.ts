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

// 部分更新で未指定と明示消去を区別するため、undefined は変更なし、null と空文字は消去、文字列以外は未指定として扱う。他機能と将来の変更が結合しないようローカルに保つ。
export function normalizeOptionalString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

// ログインチャネルの ID と秘密値が片方だけだと、開始とコールバックが異なる資格情報を使って認証に失敗するため、更新後の組合せを検証する。未指定の秘密値は現在値を保つ。
export function validateLoginChannelPair(
  next: { loginChannelId?: string | null | undefined; loginChannelSecret?: string | null | undefined },
  current: { login_channel_id: string | null; login_channel_secret: string | null } | null,
): string | null {
  // 未指定は現在値を維持し、null と文字列は明示的な更新として扱う。
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
