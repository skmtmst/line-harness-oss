import { tracedFetch as fetch, traceRequestInit } from '@line-crm/shared/server';
import { parseRetryAfter } from './policy.js';
import type { CallIdentity, Outcome } from './types.js';

export interface HttpAttemptOptions<T> {
  url: string;
  method?: string;
  headers?: HeadersInit;
  /** Already serialized immutable body; streams/FormData require their own adapter. */
  body?: string | ArrayBuffer;
  /** Keep the caller's EXISTING limit. No global limit is raised by this adapter. */
  maxResponseBytes: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Provider-specific business errors / accepted-retry receipts; never auto retry here. */
  interpret(response: Response, identity: Readonly<CallIdentity>): Promise<Outcome<T>>;
  /** Prove rejection without side effects (e.g. a provider's documented 429). */
  rejectedWithoutEffect?: (status: number) => boolean;
}

/** Capture URL/headers/body NOW, before any awaited journal or authorization work. */
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
    // A mutation's 5xx is not evidence that nothing happened. Even a key header
    // alone cannot authorize replay. Unknown results go to reconciliation.
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
    // General 409 is permanent. Only the provider adapter may recognize its
    // documented original acceptance receipt; no generic 409 -> success rule.
    return interpret(buffered, identity);
  };
}
