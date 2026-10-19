import { API_RETRY_WAIT, parseRetryAfter } from '../lib/external-call/policy.js';
// 共通基盤 §6-2: 外部APIは初回後に1分・5分・30分の最大3回だけ再試行する。
export const EXTERNAL_DELIVERY_MAX_ATTEMPTS = 4;
const EXTERNAL_DELIVERY_RETRY_DELAYS_MINUTES = API_RETRY_WAIT.kind === 'fixed' ? API_RETRY_WAIT.delaysMs.map(ms => ms / 60_000) : [];
/**
 * Retry-After の指定をそのまま信じる上限（分）。§6-2 の再試行間隔の
 * 最大30分にそろえる。N-374: 上限のない指定は遠すぎる未来に飛ぶため、
 * 超える指定は自動再送を止め、読めない指定だけ既定の間隔へ丸める。
 * 超過時に短い既定値へ戻すと、相手の混雑中に再送を早めてしまう。
 */
export const EXTERNAL_DELIVERY_RETRY_AFTER_MAX_MINUTES = 30;

export type SafeExternalDeliveryError = {
  code: string;
  message: string;
  retryable: boolean;
};

export function externalDeliveryStatus(error: unknown): number {
  const structured = Number((error as { status?: unknown } | null)?.status ?? 0);
  if (structured) return structured;
  const raw = error instanceof Error ? error.message : String(error);
  return Number(/LINE(?: Harness proxy)? API? error:\s*(\d{3})/i.exec(raw)?.[1]
    ?? /LINE Harness proxy error:\s*(\d{3})/i.exec(raw)?.[1]
    ?? 0);
}

/** Provider本文や秘密値を保存せず、運用者が次の行動を選べる安全な理由へ直す。 */
export function classifyExternalDeliveryError(
  error: unknown,
  missingAccountCode = 'REMINDER_LINE_ACCOUNT_NOT_FOUND',
): SafeExternalDeliveryError {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === missingAccountCode) {
    return {
      code: 'line_account_not_found',
      message: '送信に使うLINEアカウント設定を確認してください。',
      retryable: false,
    };
  }
  const status = externalDeliveryStatus(error);
  if (status === 429) {
    return {
      code: 'line_rate_limited',
      message: 'LINE側の送信上限に達しました。時間を置いて再試行します。',
      retryable: true,
    };
  }
  if ([401, 403].includes(status)) {
    return {
      code: 'line_authentication_failed',
      message: 'LINE連携の認証を確認してください。',
      retryable: false,
    };
  }
  if ([400, 404, 422].includes(status)) {
    return {
      code: 'line_rejected',
      message: '送信内容または宛先を確認してください。',
      retryable: false,
    };
  }
  if (status >= 500 || /fetch|network|timeout|socket/i.test(raw)) {
    return {
      code: 'line_temporary_failure',
      message: 'LINEへの送信に一時的に失敗しました。自動で再試行します。',
      retryable: true,
    };
  }
  return {
    code: 'delivery_failed',
    message: '送信に失敗しました。設定とLINE連携を確認してください。',
    retryable: true,
  };
}

/** Preserve a provider's absolute lower bound, independently of our retry budget. */
export function externalDeliveryNotBefore(error: unknown, now: Date): number | undefined {
  const raw = (error as { retryAfter?: unknown } | null)?.retryAfter;
  return externalDeliveryStatus(error) === 429 && typeof raw === 'string'
    ? parseRetryAfter(raw, now.getTime()) : undefined;
}

/** 完了した試行回数を受け取り、次の共通再試行時刻を返す。 */
export function externalDeliveryRetryAt(
  error: unknown,
  completedAttempts: number,
  now: Date,
  retryable: boolean,
): Date | null {
  if (!retryable || completedAttempts >= EXTERNAL_DELIVERY_MAX_ATTEMPTS) return null;
  const delay = EXTERNAL_DELIVERY_RETRY_DELAYS_MINUTES[
    Math.max(0, completedAttempts - 1)
  ] ?? EXTERNAL_DELIVERY_RETRY_DELAYS_MINUTES.at(-1)!;
  const defaultAt = now.getTime() + delay * 60_000;
  const status = externalDeliveryStatus(error);
  const retryAfter = (error as { retryAfter?: unknown } | null)?.retryAfter;
  if (status === 429 && typeof retryAfter === 'string' && retryAfter.trim()) {
    const at = parseRetryAfter(retryAfter, now.getTime());
    if (at !== undefined) {
      // Keep the existing 30-minute budget. An over-budget provider wait stops
      // automatic retries rather than shortening Retry-After or raising a limit.
      if (at - now.getTime() > EXTERNAL_DELIVERY_RETRY_AFTER_MAX_MINUTES * 60_000) return null;
      return new Date(Math.max(defaultAt, at));
    }
  }
  return new Date(defaultAt);
}
