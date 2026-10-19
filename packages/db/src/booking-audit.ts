// Compatibility entry for existing consumers; implementation lives with its feature.
export { bookingAuditInsert, listBookingAuditLogs, recordBookingAudit } from './booking/audit.js';
export type { BookingAuditActorType, BookingAuditLog, BookingAuditLogRow } from './booking/audit.js';
