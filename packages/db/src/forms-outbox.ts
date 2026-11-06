// Compatibility entry for existing consumers; implementation lives with its feature.
export { ensureFormSubmitOutboxEvent, findUnfinishedFormSubmitClaimByHash, getFormSubmitOutbox, getLatestFormSubmission, markFormSubmitOutboxDelivered, readFormSubmitOutboxPayload } from './forms/outbox.js';
