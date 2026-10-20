// Compatibility entry for existing consumers; implementation lives with its feature.
export { bookingPaymentInsertStatement, createBookingPayment, getBookingPaymentByBooking, getBookingPaymentConfig, markBookingPayment, resolveBookingPaymentConfig, resolveBookingPaymentForBooking, saveBookingPaymentConfig, saveBookingPaymentMenuSetting } from './booking/payments.js';
export type { BookingPaymentConfig, BookingPaymentMode, BookingPaymentProviderName, BookingPaymentRecord, BookingPaymentStatus } from './booking/payments.js';
