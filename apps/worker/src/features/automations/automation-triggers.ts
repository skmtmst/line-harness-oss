import { fireEvent } from '../../services/event-bus.js';
import * as handlers from './automation-trigger-handlers.js';
import type { AutomationEventInput, AutomationTriggerOptions } from './automation-trigger-handlers.js';
export { EC_TRIGGER_EVENT_TYPES, EVENT_TRIGGER_TYPES, SCHEDULE_TRIGGER_TYPES } from './automation-trigger-handlers.js';
export type { AutomationEventInput, AutomationDispatchItem, AutomationTriggerOptions } from './automation-trigger-handlers.js';

export function dispatchAutomationEvent(db: D1Database, input: AutomationEventInput, options: AutomationTriggerOptions = {}) {
  return handlers.dispatchAutomationEvent(db, input, { ...options, emitEvent: options.emitEvent ?? fireEvent });
}
export function dispatchAutomationEventWithLogging(db: D1Database, input: AutomationEventInput, options: AutomationTriggerOptions = {}) {
  return handlers.dispatchAutomationEventWithLogging(db, input, { ...options, emitEvent: options.emitEvent ?? fireEvent });
}
export function processScheduledAutomationTriggers(db: D1Database, options: AutomationTriggerOptions = {}) {
  return handlers.processScheduledAutomationTriggers(db, { ...options, emitEvent: options.emitEvent ?? fireEvent });
}
export function processOverdueSupportMarkTriggers(db: D1Database, options: AutomationTriggerOptions = {}) {
  return handlers.processOverdueSupportMarkTriggers(db, { ...options, emitEvent: options.emitEvent ?? fireEvent });
}
