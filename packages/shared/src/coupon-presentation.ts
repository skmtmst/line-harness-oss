/** Optional presentation values shared by the editor, LINE card and customer view. */
export interface CouponPresentationInput {
  couponType?: unknown;
  discount?: unknown;
  conditions?: unknown;
  code?: unknown;
  instructions?: unknown;
  description?: unknown;
  title?: unknown;
  oncePerFriend?: unknown;
  maxUsesPerFriend?: unknown;
}

export type CouponDiscount =
  | { mode: 'none' }
  | { mode: 'amount'; amountYen: number }
  | { mode: 'percent'; percent: number }
  | { mode: 'price'; beforeYen: number; afterYen: number };

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function integer(value: unknown, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

/** Missing new values preserve the existing card rather than inventing a discount. */
export function hasCouponPresentation(payload: CouponPresentationInput): boolean {
  return payload.couponType !== undefined || payload.discount !== undefined
    || payload.conditions !== undefined || payload.code !== undefined;
}

export function couponPresentationError(payload: CouponPresentationInput): string | null {
  if (!hasCouponPresentation(payload)) return null;
  if (payload.couponType !== undefined && payload.couponType !== 'none' && payload.couponType !== 'discount') {
    return 'クーポンの種類を選び直してください';
  }
  if (payload.title !== undefined && (typeof payload.title !== 'string' || text(payload.title).length > 60)) {
    return 'クーポン名は60文字以内で入力してください';
  }
  if (payload.conditions !== undefined && (typeof payload.conditions !== 'string' || text(payload.conditions).length > 30)) {
    return '利用条件は30文字以内で入力してください';
  }
  if (payload.instructions !== undefined && (typeof payload.instructions !== 'string' || text(payload.instructions).length > 500)) {
    return '利用ガイドは500文字以内で入力してください';
  }
  if (payload.code !== undefined && payload.code !== null) {
    const code = record(payload.code), value = code && text(code.text);
    if (!code || !value || value.length > 100 || /[\u0000-\u001f\u007f]/.test(String(code.text))) {
      return 'クーポンコードは改行なしの100文字以内で入力してください';
    }
  }
  if (payload.discount !== undefined) {
    const discount = record(payload.discount);
    if (!discount || !['none', 'amount', 'percent', 'price'].includes(String(discount.mode))) {
      return '割引の表示方法を選び直してください';
    }
    if (discount.mode !== 'none' && payload.couponType !== 'discount') return '割引の種類を選んでください';
    if (discount.mode === 'amount' && !integer(discount.amountYen, 1, 9_999_999)) return '円引きは1〜9,999,999円の整数で入力してください';
    if (discount.mode === 'percent' && !integer(discount.percent, 1, 99)) return '割引率は1〜99%の整数で入力してください';
    if (discount.mode === 'price' && (!integer(discount.beforeYen, 1, 9_999_999)
      || !integer(discount.afterYen, 0, 9_999_999) || Number(discount.beforeYen) <= Number(discount.afterYen))) {
      return '割引前より低い割引後の金額を0〜9,999,999円の整数で入力してください';
    }
  }
  return null;
}

/** No persistence or authorization decisions: callers validate before displaying. */
export function couponPresentation(payload: CouponPresentationInput, fallbackName: string) {
  const discount = record(payload.discount), code = record(payload.code);
  const yen = (value: unknown) => Number(value).toLocaleString('ja-JP');
  let benefit = '', beforePrice = '';
  if (payload.couponType === 'discount') {
    if (discount?.mode === 'amount') benefit = `${yen(discount.amountYen)} 円引き`;
    if (discount?.mode === 'percent') benefit = `${Number(discount.percent)}%引き`;
    if (discount?.mode === 'price') { beforePrice = `${yen(discount.beforeYen)} 円`; benefit = `${yen(discount.afterYen)} 円`; }
  }
  return {
    title: text(payload.title) || fallbackName || 'クーポン',
    kindLabel: payload.couponType === 'discount' ? '割引' : '',
    countLabel: payload.oncePerFriend === false && payload.maxUsesPerFriend == null ? '期間中は何回でも' : `${Number(payload.maxUsesPerFriend ?? 1)}回のみ使用可能`,
    timezoneNote: '日本時間（UTC+09:00）',
    benefit, beforePrice,
    conditions: text(payload.conditions),
    code: code ? text(code.text) : '',
    instructions: text(payload.instructions) || text(payload.description),
  };
}

export function defaultCouponInstructions(once = true): string {
  return [
    'お会計の際に、この画面をスタッフにご提示ください。',
    once ? '「使用済み」のクーポンは再利用できません。操作前にスタッフへ確認してください。'
      : '有効期間中は何回でも利用できます。ご利用のたびにスタッフへご提示ください。',
    '特典の内容・利用条件は、お店にご確認ください。',
  ].join('\n');
}
