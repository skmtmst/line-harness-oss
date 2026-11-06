import { LineApiError, type LineTransport } from '@line-crm/line-sdk';

import { tracedFetch as fetch, traceRequestInit } from '@line-crm/shared/server';
import { parseRetryAfter } from './policy.js';
import type { CallIdentity, Outcome } from './types.js';

/** 別の再試行ループを包まず、execute(signal) 内の新しい SDK インスタンスへ注入する。 */
export function lineTransport(signal: AbortSignal, transport: typeof fetch = fetch): LineTransport {
  return (url, init) => {
    signal.throwIfAborted();
    return transport(url, traceRequestInit(url, { ...init, signal, redirect: 'manual' }));
  };
}
export function lineFailure(error: unknown, identity: Readonly<CallIdentity>, now: number): Exclude<Outcome<never>, { kind: 'success' }> {
  if (!(error instanceof LineApiError)) return { kind: identity.effect === 'write' ? 'unknown' : 'transient', reason: 'network' };
  const transient = error.status === 408 || error.status === 429 || error.status >= 500;
  // キー付き更新でも曖昧な失敗後は照合し、安易に再送しない。
  return { kind: transient ? identity.effect === 'write' ? 'unknown' : 'transient' : 'permanent',
    reason: 'http', status: error.status, retryAt: parseRetryAfter(error.retryAfter, now) };
}
