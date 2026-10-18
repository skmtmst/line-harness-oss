import type { MiddlewareHandler } from 'hono';
import { isApiErrorCode, readApiError, type ApiErrorResponse, type ApiFieldErrors } from '@line-crm/shared';
import { createInvocationContext, currentInvocation, logger, runWithInvocation } from '@line-crm/shared/server';
import { inputErrorMessage, readBoundedText } from '../lib/input-errors.js';

export const HTTP_ERROR_CODES: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: '入力内容を確認してください。' },
  401: { code: 'UNAUTHORIZED', message: 'ログインの状態を確認し、開き直してください。' },
  403: { code: 'FORBIDDEN', message: 'この操作は許可されていません。アカウントと権限を確認してください。' },
  404: { code: 'NOT_FOUND', message: '対象が見つかりません。一覧から開き直してください。' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'この方法では操作できません。画面を開き直してください。' },
  409: { code: 'CONFLICT', message: '内容や状態が変わりました。最新の内容を確認してください。' },
  410: { code: 'GONE', message: '有効期限を過ぎたか、利用できなくなりました。開き直してください。' },
  411: { code: 'LENGTH_REQUIRED', message: 'ファイルのサイズを確認できません。ファイルを選び直してください。' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: '送信内容が大きすぎます。サイズを確認してください。' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '送信内容の形式を確認してください。' },
  416: { code: 'RANGE_NOT_SATISFIABLE', message: '指定した範囲を取得できません。開き直してください。' },
  422: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください。' },
  428: { code: 'PRECONDITION_REQUIRED', message: '操作に必要な確認を済ませてください。' },
  429: { code: 'RATE_LIMITED', message: '操作が集中しています。少し待ってからお試しください。' },
  500: { code: 'INTERNAL_SERVER_ERROR', message: '処理を完了できませんでした。状態を確認し、管理者にお問い合わせください。' },
  502: { code: 'UPSTREAM_ERROR', message: '連携先の処理結果を確認できません。状態を確認し、管理者にお問い合わせください。' },
  503: { code: 'SERVICE_UNAVAILABLE', message: '現在処理を利用できません。時間をおいて状態を確認してください。' },
  504: { code: 'GATEWAY_TIMEOUT', message: '連携先の応答を確認できません。処理の状態を確認してください。' },
};

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
  const fallback = HTTP_ERROR_CODES[status] ?? HTTP_ERROR_CODES[status >= 500 ? 500 : 400]!;
  const code = parsed.code ?? fallback.code;
  const message = operatorMessage(parsed.message, inputErrorMessage(code, fallback.message));
  const fields: ApiFieldErrors = { ...parsed.fields };
  // inputErrorを通らない旧来のバリデータも、同じfieldErrorsへまとめる。
  for (const [field, reason] of Object.entries(record(body.errors))) if (typeof reason === 'string') fields[field] = reason;
  for (const [field, reasons] of Object.entries(record(body.details))) {
    if (Array.isArray(reasons) && typeof reasons[0] === 'string' && fields[field] === undefined) fields[field] = reasons[0];
  }
  if (typeof body.field === 'string' && !fields[body.field]) fields[body.field] = message;
  const fieldErrors = Object.entries(fields).map(([field, reason]) => ({ field,
    message: operatorMessage(reason, isApiErrorCode(reason) ? inputErrorMessage(reason, message) : message) }));
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
    // Honoのheader()はResponseを複製する。WebSocketの101は複製できない。
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
