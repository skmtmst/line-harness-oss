// -----------------------------------------------------------------------------
// Google Calendar 連携
// -----------------------------------------------------------------------------

export interface GoogleCalendarConnection {
  id: string;
  calendarId: string;
  authType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarBooking {
  id: string;
  connectionId: string;
  friendId: string | null;
  eventId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  status: "confirmed" | "cancelled" | "completed";
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}
