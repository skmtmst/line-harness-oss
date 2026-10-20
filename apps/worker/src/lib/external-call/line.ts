import { LineApiError, type LineTransport } from '@line-crm/line-sdk';

import { tracedFetch as fetch, traceRequestInit } from '@line-crm/shared/server';
import { parseRetryAfter } from './policy.js';
import type { CallIdentity, Outcome } from './types.js';

/** Inject into a NEW SDK instance INSIDE execute(signal), not around another retry loop. */
export function lineTransport(signal: AbortSignal, transport: typeof fetch = fetch): LineTransport {
  return (url, init) => {
    signal.throwIfAborted();
    return transport(url, traceRequestInit(url, { ...init, signal, redirect: 'manual' }));
  };
}
export function lineFailure(error: unknown, identity: Readonly<CallIdentity>, now: number): Exclude<Outcome<never>, { kind: 'success' }> {
  if (!(error instanceof LineApiError)) return { kind: identity.effect === 'write' ? 'unknown' : 'transient', reason: 'network' };
  const transient = error.status === 408 || error.status === 429 || error.status >= 500;
  // Conservative: even keyed mutations require reconciliation after ambiguous failure.
  return { kind: transient ? identity.effect === 'write' ? 'unknown' : 'transient' : 'permanent',
    reason: 'http', status: error.status, retryAt: parseRetryAfter(error.retryAfter, now) };
}
