// Compatibility entry for existing consumers; implementation lives with its feature.
export { createBookingCustomer, getBookingCustomer, normalizeBookingCustomerPhone, searchBookingCustomers } from './booking/customers.js';
export type { BookingCustomerDetail, BookingCustomerSummary } from './booking/customers.js';
