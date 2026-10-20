import { currentRequestId } from './context.js';
import { logger } from './logger.js';

/** transportの再試行・timeout・redirect・冪等キーは変更しない。 */
export function traceRequestInit(input: string | Request | URL, init?: RequestInit): RequestInit | undefined {
  const requestId = currentRequestId();
  if (!requestId) return init;
  const original = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  let headers: RequestInit['headers'];
  if (original instanceof Headers) {
    headers = new Headers(original);
    headers.set('X-Request-ID', requestId);
  } else if (Array.isArray(original)) {
    headers = [...original.filter(([name]) => name.toLowerCase() !== 'x-request-id'), ['X-Request-ID', requestId]];
  } else {
    // カスタムtransportがrecordの名前を読む既存契約も保つ。
    headers = { ...Object.fromEntries(Object.entries(original ?? {}).filter(([name]) => name.toLowerCase() !== 'x-request-id')), 'X-Request-ID': requestId };
  }
  return { ...init, headers };
}
export async function tracedFetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
  const started = Date.now();
  logger.info('external.request.started');
  try {
    const response = await globalThis.fetch(input, traceRequestInit(input, init));
    logger.info('external.request.finished', { status: response.status, durationMs: Date.now() - started });
    return response;
  } catch (error) {
    logger.warn('external.request.failed', { durationMs: Date.now() - started });
    throw error;
  }
}
