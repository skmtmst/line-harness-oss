import { AsyncLocalStorage } from 'node:async_hooks';

export type InvocationSource = 'http' | 'cron' | 'queue' | 'email';
export interface InvocationContext { readonly requestId: string; readonly source: InvocationSource; readonly invocationId: string }
const storage = new AsyncLocalStorage<InvocationContext>();

/** 入力のIDを採用しない。PIIを追跡番号としてログへ混ぜることを防ぐ。 */
export function createInvocationContext(source: InvocationSource): InvocationContext {
  const requestId = crypto.randomUUID();
  return Object.freeze({ requestId, invocationId: requestId, source });
}
export function currentInvocation(): InvocationContext | undefined { return storage.getStore(); }
export function currentRequestId(): string | undefined { return currentInvocation()?.requestId; }
export function runWithInvocation<T>(context: InvocationContext, run: () => T): T { return storage.run(context, run); }
export function withInvocation<T>(source: InvocationSource, run: () => T): T {
  return runWithInvocation(createInvocationContext(source), run);
}
/** 既存の永続メタデータからだけ再開する。任意のヘッダーや本文は渡さない。 */
export function resumeInvocation<T>(requestId: string | undefined, run: () => T): T {
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return run();
  const context = currentInvocation() ?? createInvocationContext('cron');
  return runWithInvocation({ ...context, requestId }, run);
}
