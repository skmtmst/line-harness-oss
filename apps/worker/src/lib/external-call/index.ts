import { retryTime, validateState } from './policy.js';
import { resumeInvocation } from '@line-crm/shared/server';
import type { CallRequest, CallResult, CallState, CircuitStore, Outcome } from './types.js';
export * from './types.js';
export * from './policy.js';
export { MemoryCircuitStore } from './circuit.js';
export { createHttpAttempt } from './http.js';

/** One invocation = at most one physical attempt. Long waits go back to the job/cron. */
export function createExternalCall(options: { circuits: CircuitStore; now?: () => number; random?: () => number }) {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  return function externalCall<T>(request: CallRequest<T>): Promise<CallResult<T>> {
    return resumeInvocation(request.state.requestId, () => execute(request));
  };
  async function execute<T>(request: CallRequest<T>): Promise<CallResult<T>> {
    // Isolate the immutable identity/budget from caller changes across awaits.
    const state = structuredClone(request.state);
    validateState(state);
    if (state.phase !== 'ready') {
      return { kind: state.phase === 'started' ? 'unknown' : state.phase, state };
    }
    const persist = async (previous: CallState, next: CallState): Promise<'ok' | 'conflict' | 'storage_error'> => {
      try { return await request.journal.compareAndSwap(structuredClone(previous), structuredClone(next)) ? 'ok' : 'conflict'; }
      catch { return 'storage_error'; }
    };
    const stop = async (): Promise<CallResult<T>> => {
      const next: CallState = { ...state, phase: 'stopped', reason: 'budget', revision: state.revision + 1 };
      const saved = await persist(state, next);
      return { kind: saved === 'ok' ? 'stopped' : saved, state: saved === 'ok' ? next : state };
    };
    if (state.attempts >= state.policy.maxAttempts || now() >= state.policy.deadlineAt) return stop();
    if (state.nextAt > now()) return { kind: 'deferred', reason: 'schedule', nextAt: state.nextAt, state };
    if (request.signal?.aborted) return { kind: 'stopped', state };
    let admission;
    try { admission = await options.circuits.acquire(state.identity.scope, now()); }
    catch { return { kind: 'storage_error', state }; }
    if (!admission.allowed) return { kind: 'deferred', reason: 'circuit', nextAt: admission.nextAt, state };
    const lease = admission.lease;
    const settle = async (result: 'success' | 'failure' | 'neutral', retryAt?: number) => {
      // A storage failure must not overwrite a successfully journaled operation.
      // Failed release is fail-closed (probe remains occupied).
      try { await options.circuits.settle(lease, result, now(), retryAt); } catch { /* keep stopped */ }
    };
    let allowed = false;
    try { allowed = await request.authorize(); } catch { /* fail closed */ }
    if (!allowed || request.signal?.aborted || now() >= state.policy.deadlineAt) {
      await settle('neutral');
      return { kind: 'stopped', state };
    }
    const started: CallState = { ...state, phase: 'started', attempts: state.attempts + 1, revision: state.revision + 1 };
    const claimed = await persist(state, started);
    if (claimed !== 'ok') { await settle('neutral'); return { kind: claimed, state }; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel!: () => void;
    const interrupted = new Promise<Outcome<T>>(resolve => {
      const interrupt = (reason: 'timeout' | 'cancelled') => {
        controller.abort();
        resolve({ kind: state.identity.effect === 'write' ? 'unknown' : reason === 'cancelled' ? 'permanent' : 'transient', reason });
      };
      cancel = () => interrupt('cancelled');
      timer = setTimeout(() => interrupt('timeout'), Math.min(state.policy.timeoutMs, Math.max(1, state.policy.deadlineAt - now())));
    });
    request.signal?.addEventListener('abort', cancel, { once: true });
    let outcome: Outcome<T>;
    try {
      if (request.signal?.aborted || now() >= state.policy.deadlineAt) {
        outcome = { kind: 'permanent', reason: 'cancelled' };
      } else {
        const work = request.execute(controller.signal, structuredClone(state.identity)).catch((): Outcome<T> => ({
          kind: state.identity.effect === 'write' ? 'unknown' : 'transient', reason: 'network',
        }));
        outcome = await Promise.race([work, interrupted]);
      }
    } catch {
      outcome = { kind: state.identity.effect === 'write' ? 'unknown' : 'transient', reason: 'network' };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', cancel);
    }
    // No adapter may turn authentication/permission/input failures into retries.
    if (outcome.kind !== 'success' && outcome.status !== undefined && outcome.status >= 400 && outcome.status < 500
      && outcome.status !== 408 && outcome.status !== 429) outcome = { ...outcome, kind: 'permanent' };
    let next: CallState = { ...started, revision: started.revision + 1 };
    if (outcome.kind === 'success') {
      next.phase = 'succeeded';
      delete next.reason;
      delete next.status;
    }
    else {
      next.reason = outcome.reason;
      next.status = outcome.status;
      next.phase = outcome.kind === 'unknown' ? 'unknown' : 'stopped';
      if (outcome.kind === 'transient' && next.attempts < state.policy.maxAttempts) {
        try {
          next.nextAt = Math.max(retryTime(state.policy, next.attempts, now(), random), outcome.retryAt ?? 0);
          if (Number.isSafeInteger(next.nextAt) && next.nextAt < state.policy.deadlineAt) next.phase = 'ready';
          else next.reason = 'budget';
        } catch { next.reason = 'budget'; }
      }
    }
    await settle(outcome.kind === 'success' ? 'success'
      : outcome.kind === 'transient' || outcome.kind === 'unknown' && outcome.reason !== 'cancelled' ? 'failure' : 'neutral',
    outcome.kind === 'success' ? undefined : outcome.retryAt);
    const saved = await persist(started, next);
    // External success followed by failed save is UNKNOWN, not an ordinary retry.
    if (saved !== 'ok') return { kind: 'unknown', state: { ...started, phase: 'unknown', reason: 'storage' } };
    if (outcome.kind === 'success') return { kind: 'success', state: next, value: outcome.value };
    if (next.phase === 'ready') return { kind: 'deferred', reason: 'schedule', state: next, nextAt: next.nextAt };
    return { kind: next.phase === 'unknown' ? 'unknown' : 'stopped', state: next };
  };
}
export { lineTransport, lineFailure } from './line.js';
