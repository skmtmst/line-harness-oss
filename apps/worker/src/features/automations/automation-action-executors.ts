import { fireEvent } from '../../services/event-bus.js';
import { createAutomationActionExecutors as createHandlers } from './automation-action-handlers.js';
import type { AutomationActionExecutorDependencies } from './automation-action-handlers.js';
export type { AutomationActionExecutorDependencies } from './automation-action-handlers.js';

/** ハンドラ同士を結合しないよう、業務イベントの配信は公開入口で接続する。 */
export function createAutomationActionExecutors(dependencies: AutomationActionExecutorDependencies = {}) {
  return createHandlers({ ...dependencies, emitEvent: dependencies.emitEvent ?? fireEvent });
}
