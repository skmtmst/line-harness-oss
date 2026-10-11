/**
 * 飲食店向け（テスト）「デリバリー受注」の土台。
 * 設計正本：デリバリー受注_v02.pen の D-1 `kDQHr` / D-2 `hjdqV` / D-3 `dgeTy`
 *           / D-4 `OzHLO` / D-5 `h7OeT` / D-6 `XCVGd`（2026-10-09 承認）。
 *
 * 考え方
 * - 対象は Uber Eats・出前館・ロケットナウの3サービスだけ。menu は2026-09-30に
 *   サービス終了しているので入れない。
 * - 外部の受注一元化サービス（Camel等）との契約・通信はない。各サービスの店舗向け
 *   公式窓口へ自社Workerが直接つなぐ。この層が「外へ出す」唯一の場所。
 * - 急ぎ度はここ（バックエンド）だけで決める。画面には結果と理由の文だけを渡し、
 *   判定に使う仕組みの名称は出さない（利用者指示 2026-10-09）。
 * - rt_delivery_* の時刻列はすべて INTEGER。単位は **エポック秒** に統一する。
 *   ミリ秒を混ぜると経過時間と急ぎ度が静かに壊れるので、時刻は必ず nowSec() を通す。
 * - サービスから返った自由文・本文・例外は保存しない。分類済みの符号だけを残す。
 */
import {
  EXTERNAL_DELIVERY_MAX_ATTEMPTS,
  externalDeliveryRetryAt,
} from './external-delivery-retry.js';

export const DELIVERY_SERVICES = ['ubereats', 'demaecan', 'rocketnow'] as const;
export type DeliveryService = (typeof DELIVERY_SERVICES)[number];

/** 画面に出すサービス名（D-1のカードと表のしるし、D-4の内訳、D-6の選択行）。 */
export const DELIVERY_SERVICE_LABELS: Record<DeliveryService, string> = {
  ubereats: 'Uber Eats',
  demaecan: '出前館',
  rocketnow: 'ロケットナウ',
};

export function isDeliveryService(value: unknown): value is DeliveryService {
  return typeof value === 'string' && (DELIVERY_SERVICES as readonly string[]).includes(value);
}

export type DeliveryOrderStatus =
  | 'new'
  | 'cooking'
  | 'ready'
  | 'handed_over'
  | 'canceled'
  | 'rejected';

export type DeliveryUrgency = 'urgent' | 'normal' | 'watch';

/** 状態が終わっているか。終わった注文は急ぎ度を「ふつう」で固定する。 */
export function isTerminalOrderStatus(status: DeliveryOrderStatus): boolean {
  return status === 'handed_over' || status === 'canceled' || status === 'rejected';
}

/** 画面の操作で進める次の状態（設計メモ「新着 → 調理中 → 準備完了 → 受け渡し済み」）。 */
const ORDER_TRANSITIONS: Record<DeliveryOrderStatus, DeliveryOrderStatus[]> = {
  new: ['cooking', 'rejected', 'canceled'],
  cooking: ['ready', 'canceled'],
  ready: ['handed_over', 'canceled'],
  handed_over: [],
  canceled: [],
  rejected: [],
};

export function canTransitionOrder(from: DeliveryOrderStatus, to: DeliveryOrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------- 急ぎ度の自動判定 ----------

/**
 * しきい値。D-1の見本（9分=ふつう／12分=注意／受け取り希望まで13分=急ぎ）に合わせた。
 * 数字をここに集めておき、運用で動かすときに1か所だけ直せるようにする。
 */
export const URGENCY_WANTED_SOON_MINUTES = 15;
export const URGENCY_ELAPSED_URGENT_MINUTES = 20;
export const URGENCY_ELAPSED_WATCH_MINUTES = 12;
/** 調理待ちがこの件数以上あると、同じ待ち時間でも先に手を付けたほうがよい。 */
export const URGENCY_COOKING_BACKLOG = 3;

export interface UrgencyInput {
  status: DeliveryOrderStatus;
  /** 受信時刻（エポック秒）。 */
  receivedAt: number;
  /** 受け取り希望時刻（エポック秒）。分からなければ null。 */
  wantedAt: number | null;
  /** 品数（点）。 */
  itemCount: number;
  /** 同じ店舗で調理中の件数。 */
  cookingCount: number;
  /** 判定時刻（エポック秒）。 */
  now: number;
}

export interface UrgencyResult {
  urgency: DeliveryUrgency;
  /** D-2の帯に出す理由の文。仕組みの名称は入れない。 */
  reason: string | null;
}

/**
 * 待ち時間・品数・調理待ち件数から急ぎ度を決める。
 * 画面（D-2 `hjdqV`）に出るのはここで作る結果と理由だけ。
 */
export function judgeUrgency(input: UrgencyInput): UrgencyResult {
  if (isTerminalOrderStatus(input.status)) {
    return { urgency: 'normal', reason: null };
  }
  const elapsedMinutes = Math.max(0, Math.floor((input.now - input.receivedAt) / 60));
  const untilWantedMinutes =
    input.wantedAt === null ? null : Math.floor((input.wantedAt - input.now) / 60);

  const parts: string[] = [];
  if (untilWantedMinutes !== null) {
    parts.push(
      untilWantedMinutes >= 0
        ? `受け取り希望まで${untilWantedMinutes}分`
        : `受け取り希望を${Math.abs(untilWantedMinutes)}分超過`,
    );
  } else {
    parts.push(`受信から${elapsedMinutes}分`);
  }
  parts.push(`品数${input.itemCount}点`);
  parts.push(`調理待ち${input.cookingCount}件`);
  const basis = parts.join('・');

  const wantedSoon =
    untilWantedMinutes !== null && untilWantedMinutes <= URGENCY_WANTED_SOON_MINUTES;
  const waitedTooLong = elapsedMinutes >= URGENCY_ELAPSED_URGENT_MINUTES;
  if (wantedSoon || waitedTooLong) {
    return { urgency: 'urgent', reason: `${basis}のため、先に調理を始めるのがおすすめです` };
  }

  const nearWatch = elapsedMinutes >= URGENCY_ELAPSED_WATCH_MINUTES;
  const backlogged = input.cookingCount >= URGENCY_COOKING_BACKLOG && input.itemCount >= 4;
  if (nearWatch || backlogged) {
    return { urgency: 'watch', reason: `${basis}のため、進み具合を確認してください` };
  }

  return { urgency: 'normal', reason: null };
}

// ---------- 画面に出す要約 ----------

export interface DeliveryItemLike {
  name: string;
  quantity: number;
}

/**
 * D-1／D-4の「注文内容」列の要約。
 * 見本：2品までは並べる（「バターチキンカレー×2 ナン×2」）、3品以上は
 * 先頭だけ出して残りの**品数（行数）**を添える（「唐揚げ弁当×2 ほか3点」）。
 * 「点」は数量の合計ではなく品目の数。D-2の「品数4点」と同じ数え方にそろえる。
 */
export const SUMMARY_INLINE_ITEM_LIMIT = 2;

export function summarizeOrderItems(items: DeliveryItemLike[]): string {
  if (items.length === 0) return '';
  const text = (item: DeliveryItemLike) => `${item.name}×${item.quantity}`;
  if (items.length <= SUMMARY_INLINE_ITEM_LIMIT) return items.map(text).join(' ');
  return `${text(items[0])} ほか${items.length - 1}点`;
}

/** 受付停止の長さ（D-6の「30分」「60分」「90分」「本日中」）。 */
export type IntakeStopPreset = '30m' | '60m' | '90m' | 'today';

export const INTAKE_STOP_PRESETS: IntakeStopPreset[] = ['30m', '60m', '90m', 'today'];

export function isIntakeStopPreset(value: unknown): value is IntakeStopPreset {
  return typeof value === 'string' && (INTAKE_STOP_PRESETS as string[]).includes(value);
}

/**
 * 自動再開の時刻（エポック秒）。「本日中」は店舗の時間帯で当日の終わりまで。
 * 時間帯は Asia/Tokyo 固定。サービス側の締めも日本時間で動くため合わせる。
 */
export function intakeStopUntil(preset: IntakeStopPreset, now: number): number {
  if (preset === '30m') return now + 30 * 60;
  if (preset === '60m') return now + 60 * 60;
  if (preset === '90m') return now + 90 * 60;
  // 「本日中」= 日本時間のその日の 23:59:59 まで。
  const jst = new Date((now + 9 * 3600) * 1000);
  const endOfDayJst = Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate(),
    23,
    59,
    59,
  );
  return Math.floor(endOfDayJst / 1000) - 9 * 3600;
}

// ---------- 日本時間の1日 ----------

/** 日本時間の時差。サービス側の締めも日本時間で動くため固定で合わせる。 */
const JST_OFFSET_SECONDS = 9 * 3600;

const DATE_TEXT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** エポック秒を日本時間の `YYYY-MM-DD` にする。 */
export function tokyoDateText(now: number): string {
  return new Date((now + JST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

export interface TokyoDayRange {
  dateText: string;
  /** この秒以上 */
  from: number;
  /** この秒未満 */
  to: number;
}

/**
 * 日本時間のその日の範囲。D-1の「本日」とD-4の日付指定はどちらもこれで数える。
 * 形のおかしい指定・存在しない日付は当日へ落とす（画面の操作で壊れないようにする）。
 */
export function tokyoDayRange(dateText: string | null | undefined, now: number): TokyoDayRange {
  const requested = typeof dateText === 'string' ? dateText.trim() : '';
  const text = DATE_TEXT_PATTERN.test(requested) ? requested : tokyoDateText(now);
  const [year, month, day] = text.split('-').map(Number);
  const from = Math.floor(Date.UTC(year, month - 1, day) / 1000) - JST_OFFSET_SECONDS;
  // 2026-13-45 のような日付は Date.UTC が繰り上げるため、往復で確かめて当日へ戻す。
  if (tokyoDateText(from) !== text) return tokyoDayRange(null, now);
  return { dateText: text, from, to: from + 24 * 3600 };
}

// ---------- 各サービスへの送信 ----------

export type DeliveryAction =
  | 'accept'
  | 'reject'
  | 'ready'
  | 'handed_over'
  | 'cancel'
  | 'menu_sold_out'
  | 'menu_resume'
  | 'intake_stop'
  | 'intake_resume';

/** サービス側のどの窓口を叩くか。実際のパスは各サービスの仕様に合わせて設定で差し替える。 */
const ACTION_PATHS: Record<DeliveryAction, string> = {
  accept: '/orders/accept',
  reject: '/orders/reject',
  ready: '/orders/ready',
  handed_over: '/orders/handed-over',
  cancel: '/orders/cancel',
  menu_sold_out: '/menu/sold-out',
  menu_resume: '/menu/resume',
  intake_stop: '/intake/stop',
  intake_resume: '/intake/resume',
};

export interface DeliveryEnv {
  RT_DELIVERY_SEND_ENABLED?: string;
  RT_DELIVERY_UBEREATS_API_BASE_URL?: string;
  RT_DELIVERY_UBEREATS_API_TOKEN?: string;
  RT_DELIVERY_UBEREATS_WEBHOOK_SECRET?: string;
  RT_DELIVERY_DEMAECAN_API_BASE_URL?: string;
  RT_DELIVERY_DEMAECAN_API_TOKEN?: string;
  RT_DELIVERY_DEMAECAN_WEBHOOK_SECRET?: string;
  RT_DELIVERY_ROCKETNOW_API_BASE_URL?: string;
  RT_DELIVERY_ROCKETNOW_API_TOKEN?: string;
  RT_DELIVERY_ROCKETNOW_WEBHOOK_SECRET?: string;
}

/** 'true' のときだけ各サービスへ送る。既定は送らない（読み取りと記録だけ）。 */
export function deliverySendEnabled(env: DeliveryEnv): boolean {
  return env.RT_DELIVERY_SEND_ENABLED?.trim().toLowerCase() === 'true';
}

export function deliveryWebhookSecret(env: DeliveryEnv, service: DeliveryService): string | null {
  const raw =
    service === 'ubereats'
      ? env.RT_DELIVERY_UBEREATS_WEBHOOK_SECRET
      : service === 'demaecan'
        ? env.RT_DELIVERY_DEMAECAN_WEBHOOK_SECRET
        : env.RT_DELIVERY_ROCKETNOW_WEBHOOK_SECRET;
  const secret = raw?.trim() ?? '';
  // 短い鍵は事故のもとなので使わない（ec-integrations.ts と同じ 32 文字以上）。
  return secret.length >= 32 ? secret : null;
}

function apiConfigFor(
  env: DeliveryEnv,
  service: DeliveryService,
): { baseUrl: string; token: string } | null {
  const baseUrl = (
    service === 'ubereats'
      ? env.RT_DELIVERY_UBEREATS_API_BASE_URL
      : service === 'demaecan'
        ? env.RT_DELIVERY_DEMAECAN_API_BASE_URL
        : env.RT_DELIVERY_ROCKETNOW_API_BASE_URL
  )?.trim();
  const token = (
    service === 'ubereats'
      ? env.RT_DELIVERY_UBEREATS_API_TOKEN
      : service === 'demaecan'
        ? env.RT_DELIVERY_DEMAECAN_API_TOKEN
        : env.RT_DELIVERY_ROCKETNOW_API_TOKEN
  )?.trim();
  if (!baseUrl || !token) return null;
  if (!baseUrl.startsWith('https://')) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

/** 画面に出す安全な失敗理由。サービスの本文は入れない。 */
export interface SafeDeliveryError {
  code: string;
  message: string;
  retryable: boolean;
}

const DELIVERY_ERROR_MESSAGES: Record<string, { message: string; retryable: boolean }> = {
  delivery_send_disabled: {
    message: 'この環境では各サービスへの送信が止まっています。設定を有効にしてからやり直してください。',
    retryable: false,
  },
  delivery_not_configured: {
    message: 'このサービスとの連携設定が未完了です。連携を設定してからやり直してください。',
    retryable: false,
  },
  delivery_authentication_failed: {
    message: 'サービス側の認証に失敗しました。連携の設定を確認してください。',
    retryable: false,
  },
  delivery_rejected: {
    message: 'サービス側で受け付けられませんでした。注文の状態を確認してください。',
    retryable: false,
  },
  delivery_rate_limited: {
    message: 'サービス側の制限に達しました。少し待ってからやり直してください。',
    retryable: true,
  },
  delivery_temporary_failure: {
    message: 'サービス側で一時的な問題が起きました。少し待ってからやり直してください。',
    retryable: true,
  },
  delivery_timeout: {
    message: 'サービスへの送信が時間内に終わりませんでした。少し待ってからやり直してください。',
    retryable: true,
  },
};

export function safeDeliveryError(code: string): SafeDeliveryError {
  const known = DELIVERY_ERROR_MESSAGES[code] ?? DELIVERY_ERROR_MESSAGES.delivery_temporary_failure;
  return { code, message: known.message, retryable: known.retryable };
}

/**
 * HTTPの様子だけを見て分類する。
 * external-delivery-retry.ts の分類はLINE向けの符号なので、ここでは配達サービス向けに作る。
 * 再試行の間隔（1分・5分・30分／最大4回）だけ共通基盤から借りる。
 */
export function classifyDeliveryStatus(status: number): SafeDeliveryError {
  if (status === 401 || status === 403) return safeDeliveryError('delivery_authentication_failed');
  if (status === 429) return safeDeliveryError('delivery_rate_limited');
  if (status >= 500) return safeDeliveryError('delivery_temporary_failure');
  return safeDeliveryError('delivery_rejected');
}

export interface DeliveryDispatchRequest {
  service: DeliveryService;
  action: DeliveryAction;
  /** サービス側の識別子（注文ID・商品ID）。サービス単位の操作では省く。 */
  externalId?: string | null;
  /** 送る本文。秘密値は入れない。 */
  body?: Record<string, unknown>;
}

export type DeliveryDispatchResult =
  | { ok: true }
  | { ok: false; error: SafeDeliveryError; nextAttemptAt: number | null };

const SEND_TIMEOUT_MS = 10_000;
/** 送る本文の上限。想定外に大きい本文を外へ出さない。 */
const MAX_SEND_BYTES = 64 * 1024;

/**
 * 1件分の送信。成功（ok:true）のときだけ呼び出し側がD1の状態を進める。
 * 失敗時は状態を変えないので、画面から押し直せる（設計メモ「送信に失敗した場合は
 * 画面にエラーを表示し、状態は変えない」）。
 */
export async function dispatchToDeliveryService(
  env: DeliveryEnv,
  request: DeliveryDispatchRequest,
  options: {
    completedAttempts: number;
    now: Date;
    fetcher?: typeof fetch;
  },
): Promise<DeliveryDispatchResult> {
  const failWith = (error: SafeDeliveryError): DeliveryDispatchResult => {
    // 再試行の間隔（1分・5分・30分／最大4回）だけ共通基盤から借りる。
    const retryAt = externalDeliveryRetryAt(
      { status: error.code === 'delivery_rate_limited' ? 429 : 500 },
      options.completedAttempts,
      options.now,
      error.retryable,
    );
    return {
      ok: false,
      error,
      nextAttemptAt: retryAt ? Math.floor(retryAt.getTime() / 1000) : null,
    };
  };

  if (!deliverySendEnabled(env)) return failWith(safeDeliveryError('delivery_send_disabled'));
  const config = apiConfigFor(env, request.service);
  if (!config) return failWith(safeDeliveryError('delivery_not_configured'));
  if (options.completedAttempts >= EXTERNAL_DELIVERY_MAX_ATTEMPTS) {
    return { ok: false, error: safeDeliveryError('delivery_rejected'), nextAttemptAt: null };
  }

  const payload = JSON.stringify({
    ...(request.externalId ? { external_id: request.externalId } : {}),
    ...(request.body ?? {}),
  });
  if (new TextEncoder().encode(payload).byteLength > MAX_SEND_BYTES) {
    return failWith(safeDeliveryError('delivery_rejected'));
  }

  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl}${ACTION_PATHS[request.action]}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: payload,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    // 例外の本文は残さない。種類だけで時間切れかどうかを分ける。
    const timedOut = error instanceof Error && /timeout|aborted/i.test(error.name + error.message);
    return failWith(safeDeliveryError(timedOut ? 'delivery_timeout' : 'delivery_temporary_failure'));
  }

  if (!response.ok) return failWith(classifyDeliveryStatus(response.status));
  return { ok: true };
}
