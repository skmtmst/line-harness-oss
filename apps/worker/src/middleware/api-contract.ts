import type { MiddlewareHandler } from 'hono';
import { readApiError, type ApiErrorResponse, type ApiFieldErrors } from '@line-crm/shared';
import { createInvocationContext, currentInvocation, logger, runWithInvocation } from '@line-crm/shared/server';
import { readBoundedText } from '../lib/input-errors.js';

import { failureDetail } from '../lib/fail.js';
export { HTTP_ERROR_CODES } from '../lib/http-errors.js';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** 自由な例外・SQL・外部本文・秘密値は返さない。元の入力案内だけを保つ。 */
function operatorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/[ぁ-んァ-ヶ一-龠]/u.test(value) || value.length > 500
    || /D1_ERROR|\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b|node_modules|stack trace|https?:\/\/|<\/?(?:html|script|body)\b|(?:bearer\s+|(?:token|secret|password|authorization|api[_-]?key)\s*[:=])|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return fallback;
  return value;
}

export function normalizeApiFailure(value: unknown, status: number, requestId: string): ApiErrorResponse & Record<string, unknown> {
  const body = record(value);
  const parsed = readApiError(body);
  const detail = failureDetail(parsed.message, status, parsed.code);
  const code = detail.code;
  const message = operatorMessage(detail.localized ? detail.message : parsed.message, detail.message);
  const fields: ApiFieldErrors = { ...parsed.fields };
  // inputErrorを通らない旧来のバリデータも、同じfieldErrorsへまとめる。
  for (const [field, reason] of Object.entries(record(body.errors))) if (typeof reason === 'string') fields[field] = reason;
  for (const [field, reasons] of Object.entries(record(body.details))) {
    if (Array.isArray(reasons) && typeof reasons[0] === 'string' && fields[field] === undefined) fields[field] = reasons[0];
  }
  if (typeof body.field === 'string' && !fields[body.field]) fields[body.field] = message;
  const fieldErrors = Object.entries(fields).map(([field, reason]) => {
    const detail = failureDetail(reason, status, undefined, message);
    return { field, message: operatorMessage(detail.localized ? detail.message : reason, detail.message) };
  });
  const { error: _error, code: _code, message: _message, requestId: _requestId, fields: _fields, ...extra } = body;
  return { ...extra, success: false, error: { code, message, requestId, fieldErrors } };
}

/** 最外周。認証前の拒否、404、例外にも同じ契約とサーバー採番のIDを付ける。 */
export const apiContractMiddleware: MiddlewareHandler = async (c, next) => {
  const context = currentInvocation() ?? createInvocationContext('http');
  return runWithInvocation(context, async () => {
    const started = Date.now();
    await next();
    const response = c.res;
    // HonoのheaderはResponseを複製する。WebSocketの101は複製できない。
    if (response.status === 101) {
      try { response.headers.set('X-Request-ID', context.requestId); } catch { /* immutableなupgradeは接続を優先する。 */ }
      logger.info('request.finished', { status: response.status, durationMs: Date.now() - started });
      return;
    }
    if (response.status >= 400 && !/text\/html/i.test(response.headers.get('content-type') ?? '') && (c.req.path.startsWith('/api/')
      || /application\/(?:[\w.+-]+\+)?json/i.test(response.headers.get('content-type') ?? ''))) {
      let payload: unknown;
      let text: string | null = null;
      try {
        // 正規のJSONエラーの業務データを切り捨てない。非JSONの外部本文だけは全文を保持しない。
        text = /application\/(?:[\w.+-]+\+)?json/i.test(response.headers.get('content-type') ?? '')
          ? await response.text() : await readBoundedText(response, 64 * 1024);
        payload = text === null ? undefined : JSON.parse(text);
      } catch { /* HTML・プロキシの本文・読取失敗も内部文として公開しない。 */ }
      // JSON-RPCはHTTPの失敗と別のプロトコル。負のcode/idを壊すとMCPが読めなくなる。
      if (record(payload).jsonrpc === '2.0') {
        c.res = new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
        c.header('X-Request-ID', context.requestId);
        logger.info('request.finished', { status: c.res.status, durationMs: Date.now() - started });
        return;
      }
      const headers = new Headers(response.headers);
      headers.delete('Content-Length'); headers.delete('Content-Encoding'); headers.delete('ETag');
      headers.set('Content-Type', 'application/json; charset=UTF-8');
      const cacheControl = /(?:^|,)\s*private\b/i.test(response.headers.get('Cache-Control') ?? '') ? 'private, no-store' : 'no-store';
      headers.set('Cache-Control', cacheControl);
      c.res = new Response(JSON.stringify(normalizeApiFailure(payload, response.status, context.requestId)), {
        status: response.status, statusText: response.statusText, headers,
      });
      // Honoのres setterは元のヘッダーも引き継ぐので、書換えた本文の後で確実に外す。
      c.header('Content-Length', undefined);
      c.header('Content-Encoding', undefined);
      c.header('ETag', undefined);
      c.header('Cache-Control', cacheControl);
    }
    c.header('X-Request-ID', context.requestId);
    logger.info('request.finished', { status: c.res.status, durationMs: Date.now() - started });
  });
};
