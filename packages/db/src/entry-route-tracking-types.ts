export interface RefTracking {
  id: string;
  ref_code: string;
  friend_id: string | null;
  entry_route_id: string | null;
  source_url: string | null;
  fbclid: string | null;
  gclid: string | null;
  twclid: string | null;
  ttclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  user_agent: string | null;
  ip_address: string | null;
  line_account_id: string | null;
  ad_conversion_consent_at: string | null;
  created_at: string;
}
