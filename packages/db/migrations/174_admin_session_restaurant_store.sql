-- Keep the restaurant HQ/store view in the existing authenticated session.
-- The opaque session token stays in the HttpOnly cookie/Bearer fallback; a
-- store id is never trusted from a client-side cookie.
ALTER TABLE admin_sessions
  ADD COLUMN selected_restaurant_store_id TEXT
  REFERENCES rt_stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admin_sessions_restaurant_store
  ON admin_sessions(selected_restaurant_store_id)
  WHERE selected_restaurant_store_id IS NOT NULL;
