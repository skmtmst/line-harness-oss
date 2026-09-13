import type { TenantBilling } from '@line-crm/db';

/**
 * 料金プランと、いま何ができるか（権利）の判定。★V6 36-2。
 *
 * 金額は Stripe の価格が正本。ここに書いた金額は画面に出す「仮の表示」で、
 * Stripe から取れたときはそちらを出す（`docs/hq-banner-generation.md`、
 * 決定 2026-09-13）。課金の状態の意味は migration 291 のコメントにある。
 */

export type PlanKey = 'light' | 'standard' | 'pro';

export interface BillingPlan {
  key: PlanKey;
  name: string;
  /** 一言の説明。「1店舗で始める」など。 */
  description: string;
  /** 仮の月額（税込）。Stripe の価格が取れたらそちらを優先する。 */
  fallbackMonthlyYen: number;
  /** バナー生成の月間枚数。 */
  monthlyImages: number;
  /** 権限者の上限。null は無制限。 */
  maxStaff: number | null;
  /** 画面に出す内容の箇条書き。 */
  features: string[];
  recommended?: boolean;
  /** ボタンの種類。checkout は Stripe の申込画面へ、contact はお問い合わせへ（設計 36-2 のプロ）。 */
  cta: 'checkout' | 'contact';
}

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: 'light',
    name: 'ライト',
    description: '1店舗で始める',
    fallbackMonthlyYen: 9800,
    monthlyImages: 50,
    maxStaff: 3,
    features: ['LINE公式アカウント 1', '権限者 3人', '配信 月 5,000通', 'バナー生成 月 50枚', '登録メディア 5GB'],
    cta: 'checkout',
  },
  {
    key: 'standard',
    name: 'スタンダード',
    description: '複数店舗をまとめて運用',
    fallbackMonthlyYen: 29800,
    monthlyImages: 150,
    maxStaff: 10,
    features: ['LINE公式アカウント 5', '権限者 10人', '配信 月 30,000通', 'バナー生成 月 150枚', '登録メディア 30GB', '統括ひな形の配布'],
    recommended: true,
    cta: 'checkout',
  },
  {
    key: 'pro',
    name: 'プロ',
    description: '本部主導で大きく回す',
    fallbackMonthlyYen: 59800,
    monthlyImages: 500,
    maxStaff: null,
    features: ['LINE公式アカウント 無制限', '権限者 無制限', '配信 月 100,000通', 'バナー生成 月 500枚', '登録メディア 200GB', '優先サポート・API'],
    cta: 'contact',
  },
];

export const TRIAL_DAYS = 30;
export const TRIAL_MONTHLY_IMAGES = 20;
/** トライアル終了・解約後にデータを残す日数（画面の案内に使う）。 */
export const DATA_RETENTION_DAYS = 90;
/** 課金対象外（運営）のときの生成上限の既定。`BANNER_MONTHLY_IMAGES` で上書きできる。 */
export const EXEMPT_MONTHLY_IMAGES = 150;

export function findPlan(key: string | null | undefined): BillingPlan | null {
  if (!key) return null;
  return BILLING_PLANS.find((p) => p.key === key) ?? null;
}

/** Stripe の価格 ID → プラン。価格 ID は env（値は Git に書かない）。 */
export function planKeyForPrice(
  env: { STRIPE_PRICE_LIGHT?: string; STRIPE_PRICE_STANDARD?: string; STRIPE_PRICE_PRO?: string },
  priceId: string | null | undefined,
): PlanKey | null {
  if (!priceId) return null;
  if (env.STRIPE_PRICE_LIGHT && priceId === env.STRIPE_PRICE_LIGHT) return 'light';
  if (env.STRIPE_PRICE_STANDARD && priceId === env.STRIPE_PRICE_STANDARD) return 'standard';
  if (env.STRIPE_PRICE_PRO && priceId === env.STRIPE_PRICE_PRO) return 'pro';
  return null;
}

export function priceIdForPlan(
  env: { STRIPE_PRICE_LIGHT?: string; STRIPE_PRICE_STANDARD?: string; STRIPE_PRICE_PRO?: string },
  key: PlanKey,
): string | null {
  const id = key === 'light' ? env.STRIPE_PRICE_LIGHT : key === 'standard' ? env.STRIPE_PRICE_STANDARD : env.STRIPE_PRICE_PRO;
  return id || null;
}

export type EntitlementState = 'exempt' | 'trialing' | 'active' | 'past_due' | 'trial_expired' | 'canceled';

export interface Entitlements {
  state: EntitlementState;
  /** 配信（一斉配信・シナリオ・リマインダ・自動応答）ができるか。 */
  canSend: boolean;
  /** バナー生成ができるか。 */
  canGenerate: boolean;
  /** バナー生成の月間枚数。 */
  monthlyImages: number;
  /** 止まっているときの理由。運用者に出す文。 */
  blockedReason: string | null;
  /** トライアルの残り日数（トライアル中だけ）。 */
  trialDaysLeft: number | null;
  plan: BillingPlan | null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const normalized = value.replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 統括の課金状態から、いま何ができるかを決める。
 *
 * - exempt: 何も止めない（運営・移行前の統括）
 * - trialing: 期限内なら全部使える。過ぎたら trial_expired として止める
 * - active: 全部使える
 * - past_due: 止めない。案内だけ（Stripe が再試行している間に止めると、支払えば戻る人まで止まる）
 * - canceled: 配信と生成を止め、閲覧はできる
 */
export function resolveEntitlements(
  billing: Pick<TenantBilling, 'plan_key' | 'plan_status' | 'trial_ends_at'> | null,
  options: { exemptMonthlyImages?: number; now?: Date } = {},
): Entitlements {
  const now = options.now ?? new Date();
  const exemptImages = options.exemptMonthlyImages ?? EXEMPT_MONTHLY_IMAGES;
  const plan = findPlan(billing?.plan_key);
  const allowed = (state: EntitlementState, monthlyImages: number, trialDaysLeft: number | null = null): Entitlements => ({
    state,
    canSend: true,
    canGenerate: true,
    monthlyImages,
    blockedReason: null,
    trialDaysLeft,
    plan,
  });
  const blocked = (state: EntitlementState, reason: string): Entitlements => ({
    state,
    canSend: false,
    canGenerate: false,
    monthlyImages: 0,
    blockedReason: reason,
    trialDaysLeft: null,
    plan,
  });

  if (!billing || billing.plan_status === 'exempt') return allowed('exempt', exemptImages);
  if (billing.plan_status === 'active') return allowed('active', plan?.monthlyImages ?? exemptImages);
  if (billing.plan_status === 'past_due') return allowed('past_due', plan?.monthlyImages ?? exemptImages);
  if (billing.plan_status === 'canceled') {
    return blocked('canceled', '契約が終了しているため、配信とバナー生成は止まっています。課金プランからプランを選ぶと再開します');
  }
  // trialing
  const ends = parseDate(billing.trial_ends_at);
  if (ends && ends.getTime() > now.getTime()) {
    const daysLeft = Math.max(Math.ceil((ends.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)), 0);
    return allowed('trialing', TRIAL_MONTHLY_IMAGES, daysLeft);
  }
  return blocked('trial_expired', '無料トライアルが終了したため、配信とバナー生成は止まっています。課金プランからプランを選ぶと再開します');
}

/** 「10/12 まで」の形。画面の札に使う。 */
export function formatJstMonthDay(value: string | null): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}/${get('day')}`;
}
