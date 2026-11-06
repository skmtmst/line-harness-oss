import { formatYen as yen } from '@line-crm/shared';
import { CUSTOMER_WORDS } from './customer-words.js';
import { api, type BookingHistoryItem, type BookingPayment, type MenuItem } from './api.js';
import { logFailure } from './user-message.js';
import { PAYMENT_STATUS, type PaymentTone } from '@line-crm/shared';

/**
 * 予約の支払いの状態を、お客さまに見せる札にする（★V8・nWby5 / L5g75）。
 * 言葉と色は管理画面と同じ共通の定義（@line-crm/shared の payment-status・）：
 * 状態の札 4 つ（未払い・支払い済み・返金済み・期限切れ）＋払い方の札「お店で払う」。
 * オンラインの支払いの記録が無く、メニューが「お店で払う」のときだけ「お店で払う」。
 * どちらでもない（支払いの無い店）は札を出さない。
 */
export type PaymentKind = 'unpaid' | 'paid' | 'refunded' | 'expired' | 'onsite';

export interface PaymentView {
  kind: PaymentKind;
  label: string;
  tone: 'confirmed' | 'pending' | 'info' | 'neutral';
  amount: number | null;
  /** 領収書のページ。返す口が無い間は null（押すと準備中の案内）。 */
  receiptUrl: string | null;
  /** 未払いの払う期限（これを過ぎると仮の予約は取り消される）。 */
  holdUntil: string | null;
  actionRequired?: boolean;
}

/** 共通の色の名前 → LIFF の札の色。 */
const TONE: Record<PaymentTone, PaymentView['tone']> = { success: 'confirmed', warning: 'pending', info: 'info', neutral: 'neutral', danger: 'neutral' };
const LABELS: Record<PaymentKind, { label: string; tone: PaymentView['tone'] }> = {
  unpaid: { label: PAYMENT_STATUS.unpaid.label, tone: TONE[PAYMENT_STATUS.unpaid.tone] },
  paid: { label: PAYMENT_STATUS.paid.label, tone: TONE[PAYMENT_STATUS.paid.tone] },
  refunded: { label: PAYMENT_STATUS.refunded.label, tone: TONE[PAYMENT_STATUS.refunded.tone] },
  expired: { label: PAYMENT_STATUS.expired.label, tone: TONE[PAYMENT_STATUS.expired.tone] },
  onsite: { label: CUSTOMER_WORDS.payOnsite, tone: TONE.info },
};

export { yen };

/** 札の文字（「お支払い済み ¥8,800」）。金額が分からないときは名前だけ。 */
export function paymentText(view: PaymentView, onsiteLabel = CUSTOMER_WORDS.payOnsite): string {
  const label = view.kind === 'onsite' ? onsiteLabel : view.label;
  return view.amount != null && view.amount > 0 ? `${label} ${yen(view.amount)}` : label;
}

export function paymentView(payment: BookingPayment | null, menu: MenuItem | undefined): PaymentView | null {
  const kind: PaymentKind | null = payment
    ? payment.status === 'paid'
      ? 'paid'
      : payment.status === 'refunded'
        ? 'refunded'
        : payment.status === 'expired'
          ? 'expired'
          : 'unpaid' // 失敗（failed）・支払い待ち（pending）はまだ払える＝未払い（共通の定義と同じ）
    : menu?.payment_mode === 'onsite'
      ? 'onsite'
      : null;
  if (!kind) return null;
  // 期限切れは払っていないので金額を出さない。
  const amount = kind === 'expired'
    ? null
    : typeof payment?.amount === 'number'
    ? payment.amount
    : kind === 'onsite' && (menu?.price_mode ?? 'fixed') === 'fixed' && menu && menu.base_price > 0
      ? menu.base_price
      : null;
  return {
    kind,
    ...LABELS[kind],
    amount,
    receiptUrl: typeof payment?.receipt_url === 'string' && payment.receipt_url ? payment.receipt_url : null,
    holdUntil: kind === 'unpaid' && typeof payment?.hold_until === 'string' ? payment.hold_until : null,
  };
}

/** 一度に支払いを読みに行く予約の数（これまでの予約は多いので先頭だけ）。 */
export const PAYMENT_LOOKUP_LIMIT = 20;

/**
 * 予約ごとの支払いの札を読む。メニューの一覧（お店で払うかどうか）は1回だけ読む。
 * 読めなかった予約は札なし（null）にして、予約の状態の札を出す。
 */
export async function loadPaymentViews(items: BookingHistoryItem[]): Promise<Record<string, PaymentView | null>> {
  const targets = items.slice(0, PAYMENT_LOOKUP_LIMIT);
  if (targets.length === 0) return {};
  let menus: MenuItem[] = [];
  try {
    menus = (await api.menus()).menus ?? [];
  } catch (e) {
    logFailure('payment-view-menus', e);
  }
  const byId = new Map(menus.map((m) => [m.id, m]));
  const entries = await Promise.all(targets.map(async (b) => {
    try {
      const res = await api.bookingPaymentStatus(b.id);
      const view = paymentView(res.payment ?? null, byId.get(b.menu_id));
      if (res.operation_status === 'unknown' || res.action_required) return [b.id, { ...(view ?? { kind: 'unpaid', amount: null, receiptUrl: null, holdUntil: null }), label: '要確認', tone: 'pending', actionRequired: true } satisfies PaymentView] as const;
      return [b.id, view] as const;
    } catch (e) {
      logFailure('payment-view-status', e);
      return [b.id, null] as const;
    }
  }));
  return Object.fromEntries(entries);
}
