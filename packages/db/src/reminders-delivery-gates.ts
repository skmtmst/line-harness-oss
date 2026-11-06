// Compatibility entry for existing consumers; implementation lives with its feature.
export { activeRuleGateSql, bookingPolicyGateSql, completeReminderIfDone, getFriendReminderSendGate, getPendingReminderDeliveries, holdExpiredLineRetryRuns, LINE_RETRY_KEY_VALIDITY_MS, markReminderStepDelivered, ownerGateSql } from './reminders/delivery-gates.js';
