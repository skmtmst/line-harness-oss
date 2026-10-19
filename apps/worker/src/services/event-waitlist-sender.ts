
export type EventWaitlistOfferSender = (offer: {
  waitlistId: string;
  retryKey?: string;
  lineAccountId: string;
  friendId: string;
  eventName: string;
  startsAt: string;
  venueName: string | null;
  venueUrl: string | null;
  token: string;
  expiresAt: string;
}) => Promise<void>;
