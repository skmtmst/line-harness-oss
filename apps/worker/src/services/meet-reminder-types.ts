
export type MeetReminderKind = 'day_before' | 'hour_before';


export interface RegisterMeetConsultationInput {
  externalEventId: string;
  friendId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meetUrl: string;
  /** 結び付く予約。版と組で後発の勝者を古い操作から守る。無いときは従来どおり無条件。 */
  bookingId?: string | null;
  bookingVersion?: number | null;
}


export interface MeetReminderSchedule {
  kind: MeetReminderKind;
  scheduledAt: string;
}
