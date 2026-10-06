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

/** 既存の「自分のイベント」の行と同じ表示項目を持つ待ちの行。 */
export interface EventWaitlistMine {
  source: 'waitlist';
  id: string;
  event_id: string;
  slot_id: string;
  status: string;
  customer_note: null;
  event_name: string;
  event_image_url: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_url: null;
  cancel_deadline_hours_before: null;
  slot_starts_at: string;
  slot_ends_at: string;
  party_size: number;
  created_at: string;
  offer_expires_at: string | null;
  /** 現在の待機者内での1始まりの順番。案内済み・終了した待ちは null。 */
  queue_position: number | null;
}
