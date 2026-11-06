import type { ApiFieldErrors } from './api-field-errors.js';

/** 共通基盤 §11。成功応答はこの型で包み直さない。 */
export interface ApiErrorDetail {
  code: string;
  message: string;
  requestId: string;
  fieldErrors: Array<{ field: string; message: string }>;
}
export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
}

const CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export function isApiErrorCode(value: unknown): value is string {
  return typeof value === 'string' && CODE.test(value);
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** 移行中も旧応答を読める。表示してよい文言の判定は各クライアントで維持する。 */
export function readApiError(value: unknown): {
  code?: string; message?: string; requestId?: string; fields: ApiFieldErrors;
} {
  const body = record(value);
  const nested = record(body.error);
  const detail = isApiErrorCode(nested.code) && typeof nested.message === 'string'
    && typeof nested.requestId === 'string' && Array.isArray(nested.fieldErrors) ? nested : {};
  const candidate = detail.code ?? (typeof body.code === 'string' ? body.code : body.error);
  const code = isApiErrorCode(candidate) ? candidate : undefined;
  const message = [detail.message, !isApiErrorCode(body.error) ? body.error : undefined, body.message, body.error].find(v => typeof v === 'string' && v.trim().length > 0) as string | undefined;
  const requestId = [detail.requestId, body.incidentId, body.requestId].find(v => typeof v === 'string' && v.length > 0) as string | undefined;
  const fields: ApiFieldErrors = {};
  for (const source of [body.fields, body.fieldErrors]) {
    for (const [key, reason] of Object.entries(record(source))) {
      if (typeof reason === 'string') Object.defineProperty(fields, key, { value: reason, enumerable: true, configurable: true });
    }
  }
  if (Array.isArray(detail.fieldErrors)) {
    for (const value of detail.fieldErrors) {
      const item = record(value);
      if (typeof item.field === 'string' && typeof item.message === 'string') {
        Object.defineProperty(fields, item.field, { value: item.message, enumerable: true, configurable: true });
      }
    }
  }
  return { code, message, requestId, fields };
}

/** LIFFの既存のbody.code/body.error分岐に渡す互換表示。通信上の正本はerrorオブジェクト。 */
export function legacyApiErrorBody(value: unknown): unknown {
  const body = record(value);
  if (!body.error || typeof body.error !== 'object') return value;
  const parsed = readApiError(body);
  return { ...body, error: parsed.code, code: parsed.code, message: parsed.message,
    requestId: parsed.requestId, fields: parsed.fields };
}
