// Compatibility entry for existing consumers; implementation lives with its feature.
export { createBookingResource, deleteBookingResourceSafely, getBookingResource, getBookingResourceBackfillStats, updateBookingResourceSafely } from './booking/resources.js';
export type { BookingResourceBackfillStats, BookingResourceDeleteResult, BookingResourceRecord, BookingResourceUpdateResult } from './booking/resources.js';
