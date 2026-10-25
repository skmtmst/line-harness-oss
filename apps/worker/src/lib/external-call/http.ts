import { tracedFetch as fetch, traceRequestInit } from '@line-crm/shared/server';
import { parseRetryAfter } from './policy.js';
import type { CallIdentity, Outcome } from './types.js';

export interface HttpAttemptOptions<T> {
  url: string;
  method?: string;
  headers?: HeadersInit;
  /** 要求本文は直列化済みで不変とする。stream/FormData は専用アダプターで扱う。 */
  body?: string | ArrayBuffer;
  /** 既存の制限を緩めないよう、呼出元の上限を保つ。 */
  maxResponseBytes: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** 事業者ごとの業務エラーや再試行の受理票を解釈するが、ここでは自動再試行しない。 */
  interpret(response: Response, identity: Readonly<CallIdentity>): Promise<Outcome<T>>;
  /** 外部の仕様に基づき、副作用なしで拒否されたことを確認する。 */
  rejectedWithoutEffect?: (status: number) => boolean;
}

/** await 中の変更が送信内容へ混入しないよう、台帳保存・認可より前に URL・ヘッダ・本文を固定する。 */
export function createHttpAttempt<T>(options: HttpAttemptOptions<T>) {
  const url = new URL(options.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || !Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes <= 0) {
    throw new TypeError('Invalid external HTTP request');
  }
  const target = url.href;
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  const body = typeof options.body === 'string' ? options.body : options.body?.slice(0);
  const maxBytes = options.maxResponseBytes;
  const transport = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const interpret = options.interpret;
  const rejected = options.rejectedWithoutEffect;
  return async (signal: AbortSignal, identity: Readonly<CallIdentity>): Promise<Outcome<T>> => {
    if (signal.aborted) return { kind: 'permanent', reason: 'cancelled' };
    const response = await transport(target, traceRequestInit(target, { method, headers: new Headers(headers),
      body: typeof body === 'string' ? body : body?.slice(0), signal, redirect: 'manual' }));
    const retryAt = parseRetryAfter(response.headers.get('retry-after'), now());
    const transient = response.status === 408 || response.status === 429 || response.status >= 500;
    // 更新の5xxは未実行の根拠にならず、キーがあるだけでも再送を許可しない。結果不明は照合へ回す。
    if (!response.ok && response.status !== 409) {
      void response.body?.cancel().catch(() => {});
      return { kind: transient ? identity.effect === 'read' || rejected?.(response.status) ? 'transient' : 'unknown' : 'permanent',
        reason: 'http', status: response.status, retryAt };
    }
    let buffered = response;
    if (response.body) {
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        if (signal.aborted) cancel();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) return { kind: identity.effect === 'write' ? 'unknown' : 'permanent', reason: 'invalid_response' };
          chunks.push(value);
        }
        if (signal.aborted) return { kind: identity.effect === 'write' ? 'unknown' : 'transient', reason: 'timeout' };
      } finally {
        signal.removeEventListener('abort', cancel);
        cancel();
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      buffered = new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    // 一般的な409は恒久的な失敗とし、事業者固有の受理票だけを専用アダプターで成功と解釈する。
    return interpret(buffered, identity);
  };
}
