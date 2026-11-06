import { ACCOUNT_STYLES, type AccountStyle } from '@line-crm/shared';

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

export type ConnectBody = {
  style?: unknown;
  tagIds?: unknown; staffIds?: unknown; parentLineAccountId?: unknown; liffId?: unknown;
  name?: unknown;
  channelId?: unknown;
  channelSecret?: unknown;
  loginChannelId?: unknown;
  loginChannelSecret?: unknown;
  importFriends?: unknown;
};

export function readConnectBody(body: ConnectBody):
  | { ok: true; value: { importFriends: boolean; style?: AccountStyle; name: string; channelId: string; channelSecret: string; loginChannelId: string; loginChannelSecret: string; tagIds: string[]; staffIds?: string[]; parentLineAccountId?: string | null; liffId?: string } }
  | { ok: false; error: string } {
  if (body.importFriends !== undefined && typeof body.importFriends !== 'boolean') return { ok: false, error: '友だちの引き継ぎはtrueまたはfalseで指定してください' };
  if (body.style !== undefined && !ACCOUNT_STYLES.includes(body.style as AccountStyle)) return { ok: false, error: 'invalid_style' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const channelSecret = typeof body.channelSecret === 'string' ? body.channelSecret.trim() : '';
  const loginChannelId = typeof body.loginChannelId === 'string' ? body.loginChannelId.trim() : '';
  const loginChannelSecret = typeof body.loginChannelSecret === 'string' ? body.loginChannelSecret.trim() : '';
  if (name.length > 40) return { ok: false, error: '表示名は40文字以内で入力してください' };
  if (!/^\d+$/.test(channelId)) return { ok: false, error: 'Messaging APIのチャネルIDは半角数字で入力してください' };
  if (!channelSecret) return { ok: false, error: 'Messaging APIのチャネルシークレットを入力してください' };
  if (!/^\d+$/.test(loginChannelId)) return { ok: false, error: 'LINE LoginのチャネルIDは半角数字で入力してください' };
  if (!loginChannelSecret) return { ok: false, error: 'LINE Loginのチャネルシークレットを入力してください' };
  const id=(v:unknown):v is string=>typeof v==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
  if (Array.isArray(body.tagIds) && body.tagIds.length > 30) return { ok: false, error: '登録前のタグは30件以内で指定してください' };
  for(const value of [body.tagIds,body.staffIds]) if(value!==undefined && (!Array.isArray(value)||value.length>50||value.some(v=>!id(v))||new Set(value).size!==value.length)) return {ok:false,error:'タグ・担当者の指定を確認してください'};
  if(body.parentLineAccountId!==undefined && body.parentLineAccountId!==null && !id(body.parentLineAccountId)) return {ok:false,error:'親アカウントを確認してください'};
  if(body.liffId!==undefined && (typeof body.liffId!=='string'||!/^\d+-[A-Za-z0-9_-]+$/.test(body.liffId))) return {ok:false,error:'LIFF IDを確認してください'};
  return { ok: true, value: { importFriends: body.importFriends !== false, style: body.style as AccountStyle | undefined, name, channelId, channelSecret, loginChannelId, loginChannelSecret, tagIds:(body.tagIds ?? []) as string[],staffIds:body.staffIds as string[]|undefined,parentLineAccountId:body.parentLineAccountId as string|null|undefined,liffId:body.liffId as string|undefined } };
}
