import { api, type BookingHistoryItem, type BookingPayment, type MenuItem } from './api.js';
import { logFailure } from './user-message.js';

/**
 * 予約の支払いの状態を、お客さまに見せる札にする（★V8・nWby5 / L5g75）。
 * 未払い・支払い済み・返金済み・期限切れ・お店で払う の 5 つ。
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
}

const LABELS: Record<PaymentKind, { label: string; tone: PaymentView['tone'] }> = {
  unpaid: { label: '未払い', tone: 'pending' },
  paid: { label: 'お支払い済み', tone: 'confirmed' },
  refunded: { label: '返金済み', tone: 'neutral' },
  expired: { label: '期限切れ', tone: 'neutral' },
  onsite: { label: 'お店で払う', tone: 'info' },
};

export function yen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/** 札の文字（「お支払い済み ¥8,800」）。金額が分からないときは名前だけ。 */
export function paymentText(view: PaymentView): string {
  return view.amount != null && view.amount > 0 ? `${view.label} ${yen(view.amount)}` : view.label;
}

export function paymentView(payment: BookingPayment | null, menu: MenuItem | undefined): PaymentView | null {
  const kind: PaymentKind | null = payment
    ? payment.status === 'paid'
      ? 'paid'
      : payment.status === 'refunded'
        ? 'refunded'
        : payment.status === 'expired' || payment.status === 'failed'
          ? 'expired'
          : 'unpaid'
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
      return [b.id, paymentView(res.payment ?? null, byId.get(b.menu_id))] as const;
    } catch (e) {
      logFailure('payment-view-status', e);
      return [b.id, null] as const;
    }
  }));
  return Object.fromEntries(entries);
}
