import type { CallIdentity, CallPolicy, CallState, WaitPolicy } from './types.js';
import { currentRequestId } from '@line-crm/shared/server';

export const API_RETRY_WAIT: WaitPolicy = Object.freeze({
  kind: 'fixed', delaysMs: Object.freeze([60_000, 300_000, 1_800_000]),
});
const DAY = 86_400_000;
export function validatePolicy(policy: CallPolicy, createdAt: number): void {
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
  const cap = policy.category === 'api' ? 4 : policy.category === 'outgoing_webhook' ? 8 : 0;
  if (!positive(policy.maxAttempts) || policy.maxAttempts > cap || !positive(policy.timeoutMs)
    || policy.timeoutMs > 2_147_483_647 || !positive(policy.deadlineAt)
    || !Number.isSafeInteger(createdAt) || createdAt < 0 || policy.deadlineAt <= createdAt
    || (policy.category === 'outgoing_webhook' && policy.deadlineAt - createdAt > DAY)) {
    throw new TypeError('Invalid external call budget');
  }
  const wait = policy.wait;
  if (wait.kind === 'fixed') {
    if (wait.delaysMs.length < policy.maxAttempts - 1 || !wait.delaysMs.every(positive)) {
      throw new TypeError('Invalid external call schedule');
    }
  } else if (wait.kind !== 'exponential' || !positive(wait.baseMs) || !positive(wait.capMs)
    || wait.baseMs > wait.capMs || !Number.isFinite(wait.jitterRatio) || wait.jitterRatio < 0 || wait.jitterRatio > 1) {
    throw new TypeError('Invalid external call backoff');
  }
}
export function scopeKey(scope: CallIdentity['scope']): string {
  const parts = [scope.accountId, scope.storeId, scope.destination, scope.connectionId];
  if (parts.some(p => typeof p !== 'string' || !p.trim())) throw new TypeError('Missing external call scope');
  return JSON.stringify(parts);
}
/** Persist this once with the existing job/outbox. Do not recreate it for retries. */
export function createCallState(identity: CallIdentity, policy: CallPolicy, now: number): CallState {
  scopeKey(identity.scope);
  if (![identity.operationId, identity.idempotencyKey, identity.snapshotId].every(v => typeof v === 'string' && !!v.trim())
    || !['read', 'write'].includes(identity.effect)) throw new TypeError('Missing external call identity');
  validatePolicy(policy, now);
  return structuredClone({ requestId: currentRequestId() ?? crypto.randomUUID(), identity, policy, createdAt: now, revision: 0, attempts: 0, phase: 'ready', nextAt: now });
}
export function validateState(state: Readonly<CallState>): void {
  validatePolicy(state.policy, state.createdAt);
  scopeKey(state.identity.scope);
  if (!Number.isSafeInteger(state.attempts) || state.attempts < 0 || state.attempts > state.policy.maxAttempts
    || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.nextAt)
    || !['ready', 'started', 'succeeded', 'unknown', 'stopped'].includes(state.phase)
    || !['read', 'write'].includes(state.identity.effect)
    || ![state.identity.operationId, state.identity.idempotencyKey, state.identity.snapshotId].every(v => typeof v === 'string' && !!v.trim())) {
    throw new TypeError('Invalid external call state');
  }
}
export function retryTime(policy: CallPolicy, attempts: number, now: number, random: () => number): number {
  const wait = policy.wait;
  if (wait.kind === 'fixed') return now + wait.delaysMs[attempts - 1]!;
  const cap = Math.min(wait.capMs, wait.baseMs * 2 ** (attempts - 1));
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw > 1) throw new TypeError('Invalid backoff random source');
  return now + Math.ceil(cap * (1 + wait.jitterRatio * (draw * 2 - 1)));
}
/** Absolute time, so storage/adapter work can never shorten Retry-After. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  const delta = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : undefined;
  if (delta !== undefined && (!Number.isFinite(delta) || delta > Number.MAX_SAFE_INTEGER - now)) return Number.MAX_SAFE_INTEGER;
  const at = delta === undefined ? Date.parse(raw) : now + delta;
  return Number.isSafeInteger(Math.ceil(at)) && at >= now ? Math.ceil(at) : undefined;
}
