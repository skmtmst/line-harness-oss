import { fireEvent } from './event-bus.js';
import * as handlers from './action-score-handlers.js';

export function applyActionScoreEvent(db: D1Database, input: Parameters<typeof handlers.applyActionScoreEvent>[1]) {
  return handlers.applyActionScoreEvent(db, input, fireEvent);
}
export function dispatchActionScoreApplications(db: D1Database, input: Parameters<typeof handlers.dispatchActionScoreApplications>[1]): Promise<void> {
  return handlers.dispatchActionScoreApplications(db, input, fireEvent);
}
