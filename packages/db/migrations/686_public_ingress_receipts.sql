-- B-333: signed conversion nonces and site event receipts are scoped and consumed once.
CREATE TABLE public_ingress_receipts (
  kind TEXT NOT NULL CHECK (kind IN ('conversion_nonce', 'site_event')),
  scope_id TEXT NOT NULL,
  receipt_key TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (kind, scope_id, receipt_key)
);
CREATE INDEX idx_public_ingress_receipts_received ON public_ingress_receipts(received_at);
