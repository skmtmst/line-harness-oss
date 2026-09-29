/** 予約スタッフのWorker・管理画面で共有する保存条件。 */
export const BOOKING_STAFF_LIMITS = {
  name: 200,
  displayName: 200,
  role: 200,
  profileImageUrl: 2_048,
  bio: 2_000,
  sortOrderMin: 0,
  sortOrderMax: 1_000_000,
} as const;

export interface BookingStaffSaveInput {
  name?: string;
  display_name?: string;
  role?: string | null;
  profile_image_url?: string | null;
  bio?: string | null;
  sort_order?: number;
  is_designation_optional?: 0 | 1;
  is_active?: 0 | 1;
  /** N-411: 本人勤務の対象となるログインユーザー(staff_members.id)。null で解除。 */
  staff_member_id?: string | null;
}

export type BookingStaffValidationResult =
  | { ok: true; value: BookingStaffSaveInput }
  | { ok: false; field: keyof BookingStaffSaveInput | 'body'; error: string };

const own = (record: Record<string, unknown>, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
);

function requiredText(
  raw: unknown,
  field: 'name' | 'display_name',
  label: string,
  max: number,
): { ok: true; value: string } | { ok: false; field: typeof field; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, field, error: `${label}は文字で入力してください` };
  }
  const value = raw.trim();
  if (!value) return { ok: false, field, error: `${label}を入力してください` };
  if (value.length > max) {
    return { ok: false, field, error: `${label}は${max}文字以内で入力してください` };
  }
  return { ok: true, value };
}

function optionalText(
  raw: unknown,
  field: 'role' | 'bio',
  label: string,
  max: number,
): { ok: true; value: string | null } | { ok: false; field: typeof field; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, field, error: `${label}は文字で入力してください` };
  }
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > max) {
    return { ok: false, field, error: `${label}は${max}文字以内で入力してください` };
  }
  return { ok: true, value };
}

function profileImageUrl(raw: unknown):
  | { ok: true; value: string | null }
  | { ok: false; field: 'profile_image_url'; error: string } {
  const field = 'profile_image_url' as const;
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, field, error: 'プロフィール画像URLは文字で入力してください' };
  }
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > BOOKING_STAFF_LIMITS.profileImageUrl) {
    return { ok: false, field, error: `プロフィール画像URLは${BOOKING_STAFF_LIMITS.profileImageUrl}文字以内で入力してください` };
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    return { ok: false, field, error: 'プロフィール画像URLはhttp://またはhttps://で始まるURLを入力してください' };
  }
  return { ok: true, value };
}

function binaryFlag(
  raw: unknown,
  field: 'is_designation_optional' | 'is_active',
  label: string,
): { ok: true; value: 0 | 1 } | { ok: false; field: typeof field; error: string } {
  if (raw === true || raw === 1) return { ok: true, value: 1 };
  if (raw === false || raw === 0) return { ok: true, value: 0 };
  return { ok: false, field, error: `${label}はオン・オフで指定してください` };
}

/**
 * 作成と部分更新を同じ条件で検証し、文字列は保存形へtrimする。
 * 更新では、送られていない項目を返さないため既存値を上書きしない。
 */
export function parseBookingStaffInput(
  raw: unknown,
  mode: 'create' | 'update',
): BookingStaffValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, field: 'body', error: 'スタッフ情報を正しい形式で入力してください' };
  }
  const body = raw as Record<string, unknown>;
  const value: BookingStaffSaveInput = {};

  for (const [field, label, max] of [
    ['name', 'スタッフ名', BOOKING_STAFF_LIMITS.name],
    ['display_name', '表示名', BOOKING_STAFF_LIMITS.displayName],
  ] as const) {
    if (mode === 'create' || own(body, field)) {
      const parsed = requiredText(body[field], field, label, max);
      if (!parsed.ok) return parsed;
      value[field] = parsed.value;
    }
  }

  for (const [field, label, max] of [
    ['role', '役職', BOOKING_STAFF_LIMITS.role],
    ['bio', '紹介文', BOOKING_STAFF_LIMITS.bio],
  ] as const) {
    if (mode === 'create' || own(body, field)) {
      const parsed = optionalText(body[field], field, label, max);
      if (!parsed.ok) return parsed;
      value[field] = parsed.value;
    }
  }

  if (mode === 'create' || own(body, 'profile_image_url')) {
    const parsed = profileImageUrl(body.profile_image_url);
    if (!parsed.ok) return parsed;
    value.profile_image_url = parsed.value;
  }

  if (mode === 'create' || own(body, 'sort_order')) {
    const rawSortOrder = own(body, 'sort_order') ? body.sort_order : 0;
    if (typeof rawSortOrder !== 'number' || !Number.isInteger(rawSortOrder)
      || rawSortOrder < BOOKING_STAFF_LIMITS.sortOrderMin
      || rawSortOrder > BOOKING_STAFF_LIMITS.sortOrderMax) {
      return {
        ok: false,
        field: 'sort_order',
        error: `並び順は${BOOKING_STAFF_LIMITS.sortOrderMin}から${BOOKING_STAFF_LIMITS.sortOrderMax}までの整数で入力してください`,
      };
    }
    value.sort_order = rawSortOrder;
  }

  for (const [field, label, defaultValue] of [
    ['is_designation_optional', '指名なし枠', 0],
    ['is_active', '有効状態', 1],
  ] as const) {
    if (mode === 'create' || own(body, field)) {
      const parsed = binaryFlag(own(body, field) ? body[field] : defaultValue, field, label);
      if (!parsed.ok) return parsed;
      value[field] = parsed.value;
    }
  }

  if (own(body, 'staff_member_id')) {
    const rawMember = body.staff_member_id;
    if (rawMember === null || rawMember === '') {
      value.staff_member_id = null;
    } else if (typeof rawMember !== 'string' || rawMember.trim().length > 200) {
      return { ok: false, field: 'staff_member_id', error: 'ログインユーザーの指定が正しくありません' };
    } else {
      value.staff_member_id = rawMember.trim();
    }
  }

  if (mode === 'update' && Object.keys(value).length === 0) {
    return { ok: false, field: 'body', error: '変更するスタッフ情報を入力してください' };
  }
  return { ok: true, value };
}
