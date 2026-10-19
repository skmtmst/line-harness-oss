// Compatibility entry for existing consumers; implementation lives with its feature.
export { formatStartsAtForStore, notificationTiming, renderNotificationText, sendBookingNotification } from '../features/booking/booking-notifier.js';
export type { BookingNotificationSender, NotificationContext, NotificationKind, SendNotificationParams } from '../features/booking/booking-notifier.js';
