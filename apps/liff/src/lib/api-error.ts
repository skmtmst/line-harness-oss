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
    const legacy = legacyApiErrorBody(payload);
    this.body = detail.code && legacy !== null && typeof legacy === 'object'
      ? { ...legacy, error: detail.code } : legacy;
  }
}

export async function responseLiffError(response: Response): Promise<LiffApiError> {
  let payload: unknown;
  try { payload = await response.json(); } catch { /* 内部の本文を表示しない。 */ }
  return new LiffApiError(response.status, payload, response.headers?.get('X-Request-ID') ?? undefined);
}

/** 新しい成功フラグを優先し、無いときだけ古いok・errorとHTTP状態を見る。 */
export async function readLiffResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await responseLiffError(response);
  const payload: unknown = await response.json();
  if (payload !== null && typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    const failed = typeof body.success === 'boolean' ? !body.success
      : body.ok === false || body.error !== undefined;
    if (failed) throw new LiffApiError(response.status, payload, response.headers.get('X-Request-ID') ?? undefined);
  }
  return payload as T;
}
