import { legacyApiErrorBody, readApiError, type ApiFieldErrors } from '@line-crm/shared';

/** 利用者向けの文だけ。古いサーバーやプロキシの本文をError.messageに含めない。 */
export function liffErrorMessage(value: unknown, fallback = '処理できませんでした。状態を確認し、もう一度開き直してください。'): string {
  const message = readApiError(value).message;
  return typeof message === 'string' && /[ぁ-んァ-ヶ一-龠]/u.test(message) && message.length <= 500
    && !/D1_ERROR|node_modules|stack trace|<\/?(?:html|script)\b|(?:bearer\s+|(?:token|secret|password)\s*[:=])/i.test(message)
    ? message : fallback;
}

export class LiffApiError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly fields: ApiFieldErrors;
  readonly body: unknown;
  constructor(readonly status: number, payload: unknown, requestId?: string) {
    super(liffErrorMessage(payload));
    this.name = 'LiffApiError';
    const detail = readApiError(payload);
    this.code = detail.code;
    this.requestId = detail.requestId ?? requestId;
    this.fields = detail.fields;
    this.body = legacyApiErrorBody(payload);
  }
}

export async function responseLiffError(response: Response): Promise<LiffApiError> {
  let payload: unknown;
  try { payload = await response.json(); } catch { /* 内部の本文を表示しない。 */ }
  return new LiffApiError(response.status, payload, response.headers?.get('X-Request-ID') ?? undefined);
}
