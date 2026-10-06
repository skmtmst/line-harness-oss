/** 本人確認済みのイベント繰上げ案内。人数は確保する席数。 */
export interface EventWaitlistOfferDetail {
  waitlistId: string;
  eventId: string;
  slotId: string;
  eventName: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  partySize: number;
  status: string;
  expiresAt: string | null;
  remainingSeconds: number;
  canAccept: boolean;
}
