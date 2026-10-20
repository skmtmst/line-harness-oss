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
/** 既存キューの内部メタデータ。業務キー・本文・再試行の設定は変えない。 */
export function traceQueueMessage<T extends object>(message: T): T & { requestId?: string } {
  const requestId = currentRequestId();
  return requestId ? { ...message, requestId } : message;
}
/** 既存の永続メタデータからだけ再開する。任意のヘッダーや本文は渡さない。 */
export function resumeInvocation<T>(requestId: unknown, run: () => T): T {
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return run();
  const context = currentInvocation() ?? createInvocationContext('cron');
  return runWithInvocation({ ...context, requestId }, run);
}
