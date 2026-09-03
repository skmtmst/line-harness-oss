// V6 共通基盤 §6-2: 外部APIは初回後に1分・5分・30分の最大3回だけ再試行する。
export const EXTERNAL_DELIVERY_MAX_ATTEMPTS = 4;
const EXTERNAL_DELIVERY_RETRY_DELAYS_MINUTES = [1, 5, 30] as const;

export type SafeExternalDeliveryError = {
  code: string;
  message: string;
  retryable: boolean;
};

function statusOf(error: unknown): number {
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
  const status = statusOf(error);
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

/** 完了した試行回数を受け取り、次の共通再試行時刻を返す。 */
export function externalDeliveryRetryAt(
  error: unknown,
  completedAttempts: number,
  now: Date,
  retryable: boolean,
): Date | null {
  if (!retryable || completedAttempts >= EXTERNAL_DELIVERY_MAX_ATTEMPTS) return null;
  const status = statusOf(error);
  const retryAfter = (error as { retryAfter?: unknown } | null)?.retryAfter;
  if (status === 429 && typeof retryAfter === 'string' && retryAfter.trim()) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(now.getTime() + seconds * 1_000);
    }
    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate) && retryDate >= now.getTime()) return new Date(retryDate);
  }
  const delay = EXTERNAL_DELIVERY_RETRY_DELAYS_MINUTES[
    Math.max(0, completedAttempts - 1)
  ] ?? EXTERNAL_DELIVERY_RETRY_DELAYS_MINUTES.at(-1)!;
  return new Date(now.getTime() + delay * 60_000);
}
