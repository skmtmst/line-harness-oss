import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { isApiErrorCode } from '@line-crm/shared';
import { inputError, inputErrorMessage } from './input-errors.js';
import { FAILURE_CODE_MESSAGES, FAILURE_MESSAGES } from './failure-messages.js';
import { HTTP_ERROR_CODES } from './http-errors.js';
import { patternedFailure } from './failure-patterns.js';

/** Only reviewed fixed reasons are translated. Never translate or echo arbitrary provider text. */
export function failureDetail(reason: unknown, status: number, existingCode?: string, fallbackMessage?: string): { code: string; message: string; localized: boolean } {
  const fixed = (typeof reason === 'string' && Object.hasOwn(FAILURE_MESSAGES, reason) ? FAILURE_MESSAGES[reason] : undefined)
    ?? patternedFailure(reason);
  const fallback = HTTP_ERROR_CODES[status] ?? HTTP_ERROR_CODES[status >= 500 ? 500 : 400]!;
  const code = existingCode ?? (isApiErrorCode(reason) ? reason : fixed?.[0]) ?? fallback.code;
  const codeMessage = Object.hasOwn(FAILURE_CODE_MESSAGES, code) ? FAILURE_CODE_MESSAGES[code] : undefined;
  return { code, message: fixed?.[1] ?? codeMessage ?? inputErrorMessage(code, fallbackMessage ?? fallback.message), localized: fixed !== undefined };
}

/** Shared route failure. HTTP/envelope normalization and redaction stay at the outer boundary. */
export function fail(c: Context, status: ContentfulStatusCode, code: string,
  extra: Record<string, unknown> = {}, fieldKeys: readonly string[] = []) {
  const detail = failureDetail(code, status, typeof extra.code === 'string' ? extra.code : undefined);
  const message = typeof extra.error === 'string' ? extra.error
    : /[ぁ-んァ-ヶ一-龠]/u.test(code) ? code : detail.message;
  return inputError(c, { ...extra, success: false, code: detail.code, error: message }, status, fieldKeys,
    typeof extra.error === 'string' ? extra.error : code);
}
