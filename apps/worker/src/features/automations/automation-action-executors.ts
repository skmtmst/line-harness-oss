import { fireEvent } from '../../services/event-bus.js';
import { createAutomationActionExecutors as createHandlers } from './automation-action-handlers.js';
import type { AutomationActionExecutorDependencies } from './automation-action-handlers.js';
export type { AutomationActionExecutorDependencies } from './automation-action-handlers.js';

/** Bind business event dispatch at the public entry, outside the handlers. */
export function createAutomationActionExecutors(dependencies: AutomationActionExecutorDependencies = {}) {
  return createHandlers({ ...dependencies, emitEvent: dependencies.emitEvent ?? fireEvent });
}
