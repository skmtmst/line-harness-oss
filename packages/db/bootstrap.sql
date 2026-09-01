-- Generated from schema.sql + migrations by scripts/generate-bootstrap.mjs.
-- Do not edit manually. Run `pnpm --dir packages/db generate:bootstrap`.
CREATE TABLE account_health_logs (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  error_code      INTEGER,
  error_count     INTEGER NOT NULL DEFAULT 0,
  check_period    TEXT NOT NULL,
  risk_level      TEXT NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('normal', 'warning', 'danger')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE account_migrations (
  id               TEXT PRIMARY KEY,
  from_account_id  TEXT NOT NULL,
  to_account_id    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  migrated_count   INTEGER NOT NULL DEFAULT 0,
  total_count      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  completed_at     TEXT
);

CREATE TABLE account_settings (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(line_account_id, key)
);

CREATE TABLE ad_conversion_logs (
  id                  TEXT PRIMARY KEY,
  ad_platform_id      TEXT NOT NULL,
  friend_id           TEXT NOT NULL,
  conversion_point_id TEXT,
  event_name          TEXT NOT NULL,
  click_id            TEXT,
  click_id_type       TEXT,
  status              TEXT DEFAULT 'pending',
  request_body        TEXT,
  response_body       TEXT,
  error_message       TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE ad_platforms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  display_name TEXT,
  config       TEXT NOT NULL DEFAULT '{}',
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), selected_restaurant_store_id TEXT
  REFERENCES rt_stores(id) ON DELETE SET NULL,
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);

CREATE TABLE admin_two_factor_challenges (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);

CREATE TABLE admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, two_factor_enabled INTEGER NOT NULL DEFAULT 0);

CREATE TABLE affiliate_clicks (
  id           TEXT PRIMARY KEY,
  affiliate_id TEXT NOT NULL REFERENCES affiliates (id) ON DELETE CASCADE,
  url          TEXT,
  ip_address   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE affiliate_links (
  id              TEXT PRIMARY KEY,
  affiliate_id    TEXT NOT NULL REFERENCES affiliates (id),
  ref_code        TEXT NOT NULL UNIQUE,
  label           TEXT,
  line_account_id TEXT REFERENCES line_accounts (id),
  offer_id        TEXT REFERENCES affiliate_offers (id),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  click_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE affiliate_offers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  reward_amount   INTEGER NOT NULL DEFAULT 0,
  reward_miles    INTEGER NOT NULL DEFAULT 0,
  mileage_program_id TEXT NOT NULL DEFAULT 'default' REFERENCES mileage_programs (id),
  line_account_id TEXT REFERENCES line_accounts (id),
  tag_id          TEXT REFERENCES tags (id),
  scenario_id     TEXT REFERENCES scenarios (id),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

CREATE TABLE affiliates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  commission_rate REAL NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  friend_id       TEXT REFERENCES friends (id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, email TEXT, hold_days INTEGER, payout_cycle TEXT, notify_on_conversion INTEGER NOT NULL DEFAULT 0);

CREATE TABLE analytics_cross_run_members (
  run_id           TEXT NOT NULL REFERENCES analytics_cross_runs(id) ON DELETE CASCADE,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  row_key          TEXT NOT NULL,
  col_key          TEXT NOT NULL,
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, row_key, col_key, friend_id)
);

CREATE TABLE analytics_cross_runs (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  query_json        TEXT NOT NULL CHECK (json_valid(query_json)),
  state             TEXT NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending','running','available','partial','unavailable','failed')),
  result_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  error_code        TEXT,
  period_from       TEXT NOT NULL,
  period_to         TEXT NOT NULL,
  time_zone         TEXT NOT NULL,
  data_cutoff_at    TEXT NOT NULL,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  completed_at      TEXT
);

CREATE TABLE analytics_daily_metrics (
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  metric_date      TEXT NOT NULL,
  metric_key       TEXT NOT NULL,
  dimension_key    TEXT NOT NULL DEFAULT '',
  dimension_value  TEXT NOT NULL DEFAULT '',
  numerator        INTEGER,
  denominator      INTEGER,
  value            REAL,
  state            TEXT NOT NULL DEFAULT 'available'
                     CHECK (state IN (
                       'available', 'pending', 'unavailable',
                       'insufficient', 'partial', 'failed'
                     )),
  data_cutoff_at   TEXT NOT NULL,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (
    line_account_id, metric_date, metric_key, dimension_key, dimension_value
  )
);

CREATE TABLE analytics_event_coverage (
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  available_from   TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('available', 'partial', 'unavailable', 'failed')),
  reason           TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (line_account_id, event_type)
);

CREATE TABLE analytics_events (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id         TEXT REFERENCES friends(id) ON DELETE SET NULL,
  visitor_key       TEXT,
  event_type        TEXT NOT NULL,
  source_kind       TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  occurred_at       TEXT NOT NULL,
  dimensions_json  TEXT NOT NULL DEFAULT '{}'
                       CHECK (json_valid(dimensions_json)),
  numeric_value     REAL,
  currency          TEXT,
  idempotency_key   TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (line_account_id, idempotency_key)
);

CREATE TABLE analytics_funnel_run_members (
  run_id               TEXT NOT NULL REFERENCES analytics_funnel_runs(id) ON DELETE CASCADE,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id            TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  group_key            TEXT NOT NULL DEFAULT 'all',
  highest_step_order   INTEGER NOT NULL,
  state                TEXT NOT NULL CHECK (state IN ('completed', 'in_progress', 'dropped')),
  started_at           TEXT NOT NULL,
  last_reached_at      TEXT NOT NULL,
  deadline_at          TEXT NOT NULL,
  PRIMARY KEY (run_id, friend_id, group_key)
);

CREATE TABLE analytics_funnel_runs (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  funnel_id           TEXT NOT NULL REFERENCES funnels(id) ON DELETE RESTRICT,
  funnel_version_id   TEXT REFERENCES analytics_funnel_versions(id) ON DELETE RESTRICT,
  cohort_from         TEXT NOT NULL,
  cohort_to           TEXT NOT NULL,
  time_zone           TEXT NOT NULL,
  data_cutoff_at      TEXT NOT NULL,
  state               TEXT NOT NULL CHECK (state IN (
                        'pending', 'available', 'unavailable', 'partial', 'failed'
                      )),
  result_json         TEXT NOT NULL CHECK (json_valid(result_json)),
  created_by          TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE analytics_funnel_versions (
  id                     TEXT PRIMARY KEY,
  funnel_id              TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  line_account_id        TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version_number         INTEGER NOT NULL CHECK (version_number >= 1),
  window_days            INTEGER NOT NULL CHECK (window_days BETWEEN 1 AND 365),
  steps_json             TEXT NOT NULL CHECK (json_valid(steps_json)),
  segment_json           TEXT CHECK (segment_json IS NULL OR json_valid(segment_json)),
  comparison_groups_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(comparison_groups_json)),
  created_by             TEXT,
  created_at             TEXT NOT NULL,
  UNIQUE (funnel_id, version_number)
);

CREATE TABLE analytics_reconciliation_runs (
  id                 TEXT PRIMARY KEY,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  range_from         TEXT NOT NULL,
  range_to           TEXT NOT NULL,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  projected_count    INTEGER NOT NULL DEFAULT 0,
  mismatch_count     INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('matched', 'mismatched', 'failed')),
  error_code         TEXT,
  started_at         TEXT NOT NULL,
  completed_at       TEXT NOT NULL,
  UNIQUE (line_account_id, range_to)
);

CREATE TABLE analytics_result_audience_members (
  audience_id         TEXT NOT NULL REFERENCES analytics_result_audiences(id) ON DELETE CASCADE,
  friend_id           TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  PRIMARY KEY (audience_id, friend_id)
);

CREATE TABLE analytics_result_audiences (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind         TEXT NOT NULL CHECK (source_kind IN ('funnel','cross')),
  source_result_id    TEXT NOT NULL,
  selection_key       TEXT NOT NULL,
  member_count        INTEGER NOT NULL DEFAULT 0,
  expires_at          TEXT NOT NULL,
  created_by          TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE analytics_saved_analyses (
  id                     TEXT PRIMARY KEY,
  line_account_id        TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('cross','funnel')),
  current_version_number INTEGER NOT NULL DEFAULT 1 CHECK (current_version_number >= 1),
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by             TEXT,
  created_by_name        TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE analytics_saved_analysis_snapshots (
  id                    TEXT PRIMARY KEY,
  saved_analysis_id     TEXT NOT NULL REFERENCES analytics_saved_analyses(id) ON DELETE CASCADE,
  analysis_version_id   TEXT NOT NULL REFERENCES analytics_saved_analysis_versions(id) ON DELETE RESTRICT,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind           TEXT NOT NULL CHECK (source_kind IN ('cross','funnel')),
  source_result_id      TEXT NOT NULL,
  period_from           TEXT NOT NULL,
  period_to             TEXT NOT NULL,
  time_zone             TEXT NOT NULL,
  data_cutoff_at        TEXT NOT NULL,
  state                 TEXT NOT NULL CHECK (state IN ('available','partial','unavailable','failed')),
  result_json           TEXT NOT NULL CHECK (json_valid(result_json)),
  created_by            TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE analytics_saved_analysis_versions (
  id                  TEXT PRIMARY KEY,
  saved_analysis_id   TEXT NOT NULL REFERENCES analytics_saved_analyses(id) ON DELETE CASCADE,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL CHECK (version_number >= 1),
  definition_json     TEXT NOT NULL CHECK (json_valid(definition_json)),
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (saved_analysis_id, version_number)
);

CREATE TABLE analytics_url_exposure_queue (
  message_id            TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','processed','failed')),
  attempts              INTEGER NOT NULL DEFAULT 0,
  available_at          TEXT NOT NULL,
  processing_started_at TEXT,
  processed_at          TEXT,
  last_error            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE analytics_url_exposures (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL,
  friend_id       TEXT REFERENCES friends(id) ON DELETE SET NULL,
  tracked_link_id TEXT NOT NULL,
  source_kind     TEXT NOT NULL,
  source_id       TEXT,
  audience_state  TEXT NOT NULL DEFAULT 'known'
                  CHECK (audience_state IN ('known','unknown')),
  sent_at         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (line_account_id, message_id, tracked_link_id)
);

CREATE TABLE auto_replies (
  id               TEXT PRIMARY KEY,
  keyword          TEXT NOT NULL,
  match_type       TEXT NOT NULL CHECK (match_type IN ('exact', 'contains')) DEFAULT 'exact',
  response_type    TEXT NOT NULL DEFAULT 'text',
  response_content TEXT NOT NULL,
  template_id      TEXT REFERENCES templates(id) ON DELETE SET NULL,
  line_account_id  TEXT DEFAULT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  -- 151: 応答したときに順に実行することの並び（シナリオのアクションと同じ形）。
  actions_json           TEXT,
  -- 151: 応答する曜日（0=日 … 6=土）。時間帯は active_from / active_until が持つ。
  response_weekdays_json TEXT,
  -- 151: 'ignore' | 'include' | 'exclude'
  response_holiday_rule  TEXT,
  -- 151: 1人につき1回だけ応答する。cooldown_minutes（N分空ける）とは別。
  once_per_friend        INTEGER NOT NULL DEFAULT 0,
  -- 151: キーワードを複数行持つ。未設定なら keyword / match_type を見る。
  keywords_json          TEXT,
  -- 157: キーワードを問わず、届いたメッセージすべてに応答する（営業時間外の案内など）。
  respond_to_all         INTEGER NOT NULL DEFAULT 0,
  -- 158: 管理用の名前。空なら keyword を代わりに出す。
  name                   TEXT,
  -- 158: キーワードが複数あるとき 'any'（どれか1つ）か 'all'（すべて）か。
  keyword_match_mode     TEXT NOT NULL DEFAULT 'any'
, active_from TEXT, active_until TEXT, cooldown_minutes INTEGER, skip_when_operator_active INTEGER NOT NULL DEFAULT 0, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0, message_kinds_json TEXT
  CHECK (message_kinds_json IS NULL OR json_valid(message_kinds_json)), friend_conditions_json TEXT
  CHECK (friend_conditions_json IS NULL OR json_valid(friend_conditions_json)));

CREATE TABLE auto_reply_hits (
  id              TEXT PRIMARY KEY,
  auto_reply_id   TEXT NOT NULL,
  friend_id       TEXT,
  line_account_id TEXT,
  matched_keyword TEXT,
  hit_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE automation_definitions (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL REFERENCES line_accounts(id),
  name                         TEXT NOT NULL,
  description                  TEXT,
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'active', 'stopped', 'archived')),
  priority                     INTEGER NOT NULL DEFAULT 0,
  current_draft_version_id     TEXT REFERENCES automation_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES automation_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  legacy_automation_id         TEXT UNIQUE,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at                  TEXT
);

CREATE TABLE automation_logs (
  id             TEXT PRIMARY KEY,
  automation_id  TEXT NOT NULL REFERENCES automations (id) ON DELETE CASCADE,
  friend_id      TEXT REFERENCES friends (id) ON DELETE SET NULL,
  event_data     TEXT,
  actions_result TEXT,
  status         TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE automation_run_steps (
  id                       TEXT PRIMARY KEY,
  automation_run_id        TEXT NOT NULL REFERENCES automation_runs(id),
  step_key                 TEXT NOT NULL,
  action_type              TEXT NOT NULL,
  common_action_version_id TEXT REFERENCES common_action_versions(id),
  attempt_number           INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  idempotency_key          TEXT NOT NULL UNIQUE,
  status                   TEXT NOT NULL DEFAULT 'queued'
                             CHECK (status IN (
                               'queued', 'running', 'waiting', 'success',
                               'failed', 'skipped', 'cancelled'
                             )),
  input_json               TEXT NOT NULL DEFAULT '{}',
  output_json              TEXT,
  error_code               TEXT,
  error_message            TEXT,
  retry_at                 TEXT,
  started_at               TEXT,
  completed_at             TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')), lease_expires_at TEXT,
  UNIQUE (automation_run_id, step_key, attempt_number)
);

CREATE TABLE automation_runs (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id),
  automation_id         TEXT NOT NULL REFERENCES automation_definitions(id),
  automation_version_id TEXT NOT NULL REFERENCES automation_versions(id),
  friend_id             TEXT REFERENCES friends(id) ON DELETE SET NULL,
  source_event_id       TEXT NOT NULL,
  idempotency_key       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN (
                            'queued', 'running', 'waiting', 'success', 'partial',
                            'failed', 'cancelled', 'skipped_condition'
                          )),
  current_step          INTEGER NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  resume_at             TEXT,
  input_event_json      TEXT NOT NULL DEFAULT '{}',
  is_test               INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  started_at            TEXT,
  completed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')), lease_expires_at TEXT, execution_plan_json TEXT,
  UNIQUE (line_account_id, automation_id, idempotency_key)
);

CREATE TABLE automation_versions (
  id                TEXT PRIMARY KEY,
  automation_id     TEXT NOT NULL REFERENCES automation_definitions(id),
  version_number    INTEGER NOT NULL CHECK (version_number > 0),
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published')),
  trigger_type      TEXT NOT NULL,
  trigger_config    TEXT NOT NULL DEFAULT '{}',
  condition_config  TEXT NOT NULL DEFAULT '{}',
  action_config     TEXT NOT NULL DEFAULT '[]',
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  published_at      TEXT,
  UNIQUE (automation_id, version_number)
);

CREATE TABLE automations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  event_type  TEXT NOT NULL,
  conditions  TEXT NOT NULL DEFAULT '{}',
  actions     TEXT NOT NULL DEFAULT '[]',
  is_active   INTEGER NOT NULL DEFAULT 1,
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, line_account_id TEXT);

CREATE TABLE booking_idempotency_keys (
  key              TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL,
  friend_id        TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT NOT NULL                  -- UTC ISO8601
);

CREATE TABLE booking_reminders (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('day_before','hours_before')),
  scheduled_at  TEXT NOT NULL,                                -- UTC ISO8601
  sent_at       TEXT,                                         -- UTC ISO8601
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','failed_permanent','cancelled')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

CREATE TABLE bookings (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL,
  friend_id               TEXT NOT NULL,        -- friends.id
  staff_id                TEXT NOT NULL,
  menu_id                 TEXT NOT NULL,
  starts_at               TEXT NOT NULL,        -- UTC ISO8601 (Z)
  ends_at                 TEXT NOT NULL,        -- UTC ISO8601 (Z)
  block_ends_at           TEXT NOT NULL,        -- ends_at + buffer_after。衝突判定
  status                  TEXT NOT NULL CHECK (status IN ('requested','confirmed','rejected','expired','cancelled','completed','no_show')),
  customer_note           TEXT,
  internal_note           TEXT,
  price_at_booking        INTEGER NOT NULL,
  requested_at            TEXT NOT NULL,        -- UTC ISO8601
  decided_at              TEXT,                 -- UTC ISO8601
  decided_by_staff_id     TEXT,
  external_event_id       TEXT,                 -- Phase 3 余地 (Google Calendar)
  external_calendar_id    TEXT,                 -- Phase 3 余地
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);

CREATE TABLE broadcast_insights (
  id                  TEXT PRIMARY KEY,
  broadcast_id        TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  delivered           INTEGER,
  unique_impression   INTEGER,
  unique_click        INTEGER,
  unique_media_played INTEGER,
  open_rate           REAL,
  click_rate          REAL,
  raw_response        TEXT,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  retry_count         INTEGER NOT NULL DEFAULT 0,
  fetched_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE broadcast_message_assets (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('rich_message', 'card_message', 'coupon', 'research')),
  name            TEXT NOT NULL,
  payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE "broadcasts" (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  message_type       TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel')),
  message_content    TEXT NOT NULL,
  target_type        TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'segment', 'multi-account-dedup')) DEFAULT 'all',
  target_tag_id      TEXT REFERENCES tags (id) ON DELETE SET NULL,
  status             TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
  scheduled_at       TEXT,
  sent_at            TEXT,
  total_count        INTEGER NOT NULL DEFAULT 0,
  success_count      INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  line_account_id    TEXT,
  alt_text           TEXT,
  line_request_id    TEXT,
  aggregation_unit   TEXT,
  batch_offset       INTEGER NOT NULL DEFAULT 0,
  segment_conditions TEXT,
  account_ids        TEXT CHECK (account_ids IS NULL OR json_valid(account_ids)),
  dedup_priority     TEXT CHECK (dedup_priority IS NULL OR json_valid(dedup_priority)),
  failed_account_ids TEXT CHECK (failed_account_ids IS NULL OR json_valid(failed_account_ids)),
  dedup_progress     TEXT,
  batch_lock_at      TEXT,
  track_links        INTEGER NOT NULL DEFAULT 1,
  message_bubbles_json TEXT CHECK (message_bubbles_json IS NULL OR json_valid(message_bubbles_json)),
  stealth_spread_minutes INTEGER NOT NULL DEFAULT 0
, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, measure_opens INTEGER NOT NULL DEFAULT 1);

CREATE TABLE calendar_bookings (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL REFERENCES google_calendar_connections (id) ON DELETE CASCADE,
  friend_id      TEXT REFERENCES friends (id) ON DELETE SET NULL,
  event_id       TEXT,
  title          TEXT NOT NULL,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  metadata       TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE carousel_taps (
  id              TEXT PRIMARY KEY,
  template_id     TEXT NOT NULL,
  column_index    INTEGER NOT NULL,
  action_index    INTEGER NOT NULL,
  action_label    TEXT,
  friend_id       TEXT,
  line_account_id TEXT,
  tapped_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE "chats" (
  id                       TEXT PRIMARY KEY,
  friend_id                TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  operator_id              TEXT REFERENCES operators (id) ON DELETE SET NULL,
  status                   TEXT NOT NULL DEFAULT 'unread'
                           CHECK (status IN ('unread', 'in_progress', 'on_hold', 'resolved')),
  notes                    TEXT,
  last_message_at          TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  line_account_id          TEXT,
  first_replied_at         TEXT,
  last_incoming_at         TEXT,
  revision                 INTEGER NOT NULL DEFAULT 0,
  last_customer_message_at TEXT,
  last_operator_message_at TEXT,
  next_response_due_at     TEXT
);

CREATE TABLE codex_cloud_tasks (
  slack_event_id               TEXT PRIMARY KEY,
  team_id                      TEXT NOT NULL,
  channel_id                   TEXT NOT NULL,
  message_ts                   TEXT NOT NULL,
  thread_ts                    TEXT NOT NULL,
  requester_user_id            TEXT NOT NULL,
  status                       TEXT NOT NULL DEFAULT 'detected'
                                 CHECK (status IN (
                                   'detected',
                                   'official_running',
                                   'official_failed',
                                   'fallback_starting',
                                   'fallback_running',
                                   'fallback_suspended',
                                   'duplicate_risk',
                                   'completed',
                                   'failed'
                                 )),
  official_task_url            TEXT,
  fallback_run_id              TEXT,
  fallback_conversation_url    TEXT,
  detected_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (channel_id, message_ts)
);

CREATE TABLE common_action_bindings (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id),
  common_action_id         TEXT NOT NULL REFERENCES common_actions(id),
  common_action_version_id TEXT NOT NULL REFERENCES common_action_versions(id),
  consumer_type            TEXT NOT NULL,
  consumer_id              TEXT NOT NULL,
  consumer_path            TEXT NOT NULL DEFAULT '',
  created_by               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (line_account_id, consumer_type, consumer_id, consumer_path, common_action_id)
);

CREATE TABLE common_action_versions (
  id               TEXT PRIMARY KEY,
  common_action_id TEXT NOT NULL REFERENCES common_actions(id),
  version_number   INTEGER NOT NULL CHECK (version_number > 0),
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published')),
  action_config    TEXT NOT NULL DEFAULT '[]',
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  published_at     TEXT,
  UNIQUE (common_action_id, version_number)
);

CREATE TABLE common_actions (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL REFERENCES line_accounts(id),
  name                         TEXT NOT NULL,
  description                  TEXT,
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'archived')),
  current_draft_version_id     TEXT REFERENCES common_action_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES common_action_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at                  TEXT
);

CREATE TABLE common_var_schedules (
  id             TEXT PRIMARY KEY,
  var_id         TEXT NOT NULL REFERENCES common_vars(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  value          TEXT NOT NULL,
  applied_at     TEXT
);

CREATE TABLE common_vars (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  -- {shop_hours} のように使う。形の制約は friend_fields.field_key と同じ。
  var_key     TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'text'
                CHECK (type IN ('text','url','image','number')),
  value       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE);

CREATE TABLE conversion_events (
  id                   TEXT PRIMARY KEY,
  conversion_point_id  TEXT NOT NULL REFERENCES conversion_points (id) ON DELETE CASCADE,
  friend_id            TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  user_id              TEXT,
  affiliate_code       TEXT,
  metadata             TEXT,
  affiliate_id         TEXT REFERENCES affiliates (id),
  attributed_ref_code  TEXT,
  approval_status      TEXT CHECK (approval_status IN ('pending','approved','rejected')),
  approved_at          TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE conversion_points (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  event_type TEXT NOT NULL,
  value      REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, measure_method TEXT NOT NULL DEFAULT 'manual'
  CHECK (measure_method IN ('url_reach', 'webhook', 'manual')), target_url TEXT, count_repeat INTEGER NOT NULL DEFAULT 1, attribution_days INTEGER, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL);

CREATE TABLE dashboard_default_preferences (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  cards TEXT NOT NULL CHECK (json_valid(cards)),
  updated_by TEXT REFERENCES staff_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE dashboard_preferences (
  staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  cards TEXT NOT NULL CHECK (json_valid(cards)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (staff_id, line_account_id)
);

CREATE TABLE ec_events (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  line_account_id   TEXT REFERENCES line_accounts(id),
  customer_id       TEXT,
  line_user_id      TEXT,
  friend_id         TEXT,
  payload           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'identity_pending', 'processing', 'processed', 'skipped', 'failed')),
  error_message     TEXT,
  received_at       TEXT NOT NULL,
  processed_at      TEXT,
  updated_at        TEXT NOT NULL,
  UNIQUE (source, external_event_id),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE SET NULL
);

CREATE TABLE ec_identity_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL REFERENCES identity_candidates(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL,
  shop_key TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  linked_by TEXT,
  linked_at TEXT NOT NULL,
  unlinked_by TEXT,
  unlinked_at TEXT,
  unlink_reason TEXT
);

CREATE TABLE ec_notification_settings (
  event_type TEXT PRIMARY KEY,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  title_override TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, intro_text TEXT, outro_text TEXT, category TEXT NOT NULL DEFAULT 'order', button_label TEXT, button_url TEXT, image_url TEXT, display_order INTEGER NOT NULL DEFAULT 100);

CREATE TABLE engagement_events (
  id                TEXT PRIMARY KEY,
  program_id        TEXT NOT NULL REFERENCES mileage_programs(id),
  idempotency_key   TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  source            TEXT NOT NULL,
  source_event_id   TEXT,
  actor_user_id     TEXT REFERENCES users(id),
  actor_friend_id   TEXT REFERENCES friends(id),
  subject_user_id   TEXT REFERENCES users(id),
  subject_friend_id TEXT REFERENCES friends(id),
  identity_provider TEXT,
  identity_subject  TEXT,
  metadata          TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  occurred_at       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  UNIQUE (program_id, idempotency_key)
);

CREATE TABLE entry_route_genres (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE entry_routes (
  id          TEXT PRIMARY KEY,
  ref_code    TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  tag_id      TEXT REFERENCES tags (id) ON DELETE SET NULL,
  scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  redirect_url TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
, pool_id TEXT REFERENCES traffic_pools (id) ON DELETE SET NULL, intro_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL, run_account_friend_add_scenarios INTEGER NOT NULL DEFAULT 1, genre TEXT, tenant_id TEXT REFERENCES tenants(id));

CREATE TABLE event_booking_idempotency_keys (
  key              TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL,
  friend_id        TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT NOT NULL
);

CREATE TABLE event_booking_reminders (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('day_before','hours_before')),
  scheduled_at  TEXT NOT NULL,
  sent_at       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','failed_permanent','cancelled')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  FOREIGN KEY (booking_id) REFERENCES event_bookings(id)
);

CREATE TABLE event_bookings (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  event_id              TEXT NOT NULL,
  slot_id               TEXT NOT NULL,
  friend_id             TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('requested','confirmed','rejected','cancelled','expired','no_show','attended')),
  customer_note         TEXT,
  internal_note         TEXT,
  requested_at          TEXT NOT NULL,
  decided_at            TEXT,
  decided_by_staff_id   TEXT,
  cancelled_at          TEXT,
  cancelled_by          TEXT CHECK (cancelled_by IN ('friend','admin','system')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), identity_key TEXT,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (slot_id) REFERENCES event_slots(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id)
);

CREATE TABLE event_slots (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  capacity    INTEGER,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE event_waitlist (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL,
  slot_id       TEXT NOT NULL,
  friend_id     TEXT NOT NULL,
  -- 予約と同じ識別子。複数アカウントの同一人物が二重に並ばないようにする。
  identity_key  TEXT NOT NULL,
  -- waiting: 待っている / invited: 空きを知らせた / converted: 予約になった
  -- / cancelled: 本人が取り消した
  status        TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'invited', 'converted', 'cancelled')),
  notified_at   TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE events (
  id                            TEXT PRIMARY KEY,
  line_account_id               TEXT NOT NULL,
  name                          TEXT NOT NULL,
  venue_name                    TEXT,
  venue_url                     TEXT,
  image_url                     TEXT,
  description                   TEXT,
  description_centered          INTEGER NOT NULL DEFAULT 0,
  max_bookings_per_friend       INTEGER,
  requires_approval             INTEGER NOT NULL DEFAULT 0,
  cancel_deadline_hours_before  INTEGER,
  reminder_day_before_enabled   INTEGER NOT NULL DEFAULT 1,
  reminder_hours_before         INTEGER,
  is_published                  INTEGER NOT NULL DEFAULT 0,
  folder_id                     TEXT,
  sort_order                    INTEGER NOT NULL DEFAULT 0,
  deleted_at                    TEXT,
  created_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), target_type TEXT NOT NULL DEFAULT 'single'
  CHECK (target_type IN ('single', 'multi-account-dedup')), account_ids TEXT
  CHECK (account_ids IS NULL OR json_valid(account_ids)), dedup_priority TEXT
  CHECK (dedup_priority IS NULL OR json_valid(dedup_priority)), failed_account_ids TEXT
  CHECK (failed_account_ids IS NULL OR json_valid(failed_account_ids)), confirmation_message_extra TEXT, reminder_message_extra TEXT, og_title TEXT, og_description TEXT, og_image_url TEXT, visible_tag_id TEXT, waitlist_enabled INTEGER NOT NULL DEFAULT 0, entry_cutoff_hours_before INTEGER,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);

CREATE TABLE "folders" (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'tag','template','scenario','reminder','auto_reply',
                  'rich_menu','webinar','form','media','common_var',
                  'mileage_rule','automation','event','entry_route','broadcast')),
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  color         TEXT
);

CREATE TABLE form_accounts (
  form_id         TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (form_id, line_account_id)
);

CREATE TABLE form_opens (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  friend_id TEXT,
  friend_name TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  fields TEXT NOT NULL DEFAULT '[]',
  on_submit_tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  on_submit_scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  save_to_metadata INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  submit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, on_submit_message_type TEXT CHECK (on_submit_message_type IN ('text', 'flex')) DEFAULT NULL, on_submit_message_content TEXT DEFAULT NULL, on_submit_webhook_url TEXT, on_submit_webhook_headers TEXT, on_submit_webhook_fail_message TEXT, og_title TEXT, og_description TEXT, og_image_url TEXT, layout TEXT);

CREATE TABLE friend_add_attribution_candidates (
  id                   TEXT PRIMARY KEY,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id            TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  ref_code             TEXT NOT NULL,
  entry_route_id       TEXT REFERENCES entry_routes(id) ON DELETE SET NULL,
  source               TEXT NOT NULL CHECK (source IN ('line_login', 'liff', 'short_link')),
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'consumed', 'expired', 'late')),
  occurred_at          TEXT NOT NULL,
  consumed_by_event_id TEXT,
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE friend_add_events (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id             TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  webhook_event_id      TEXT NOT NULL,
  friend_kind           TEXT NOT NULL CHECK (friend_kind IN ('first_time', 'returning')),
  is_unblocked_hint     INTEGER CHECK (is_unblocked_hint IS NULL OR is_unblocked_hint IN (0, 1)),
  attribution_status    TEXT NOT NULL DEFAULT 'unavailable'
                          CHECK (attribution_status IN ('captured', 'unavailable')),
  ref_code              TEXT,
  entry_route_id        TEXT REFERENCES entry_routes(id) ON DELETE SET NULL,
  candidate_id          TEXT REFERENCES friend_add_attribution_candidates(id) ON DELETE SET NULL,
  routing_rule_id       TEXT,
  routing_status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK (routing_status IN ('pending', 'completed', 'failed', 'suppressed')),
  occurred_at           TEXT NOT NULL,
  processed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, webhook_event_id)
);

CREATE TABLE friend_add_routing_versions (
  id                         TEXT PRIMARY KEY,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version_number             INTEGER NOT NULL,
  definition_snapshot        TEXT NOT NULL CHECK (json_valid(definition_snapshot)),
  status                     TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  last_test_status           TEXT CHECK (last_test_status IN ('succeeded', 'failed')),
  last_tested_at             TEXT,
  last_tested_by_staff_id    TEXT,
  published_at               TEXT,
  published_by_staff_id      TEXT,
  publish_idempotency_key    TEXT,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, version_number),
  UNIQUE (line_account_id, publish_idempotency_key)
);

CREATE TABLE friend_bulk_run_items (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES friend_bulk_runs(id) ON DELETE CASCADE,
  friend_id         TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  line_account_id   TEXT,
  ordinal           INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','waiting','success','skipped','temporary_failure','permanent_failure')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  idempotency_key   TEXT NOT NULL,
  before_json       TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json        TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  error_code        TEXT,
  error_message     TEXT,
  retry_at          TEXT,
  lease_expires_at  TEXT,
  started_at        TEXT,
  completed_at      TEXT,
  updated_at        TEXT NOT NULL,
  UNIQUE (run_id, friend_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE friend_bulk_runs (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  created_by               TEXT NOT NULL,
  selection_json           TEXT NOT NULL CHECK (json_valid(selection_json)),
  operation_json           TEXT NOT NULL CHECK (json_valid(operation_json)),
  execution_plan_json      TEXT CHECK (execution_plan_json IS NULL OR json_valid(execution_plan_json)),
  status                   TEXT NOT NULL DEFAULT 'preparing'
                             CHECK (status IN ('preparing','queued','running','waiting','success','partial','failed','cancelled')),
  target_count             INTEGER NOT NULL DEFAULT 0,
  excluded_count           INTEGER NOT NULL DEFAULT 0,
  success_count            INTEGER NOT NULL DEFAULT 0,
  skipped_count            INTEGER NOT NULL DEFAULT 0,
  temporary_failure_count  INTEGER NOT NULL DEFAULT 0,
  permanent_failure_count  INTEGER NOT NULL DEFAULT 0,
  reversible               INTEGER NOT NULL DEFAULT 0 CHECK (reversible IN (0,1)),
  idempotency_key          TEXT NOT NULL,
  scheduled_at             TEXT,
  undo_of_run_id           TEXT REFERENCES friend_bulk_runs(id),
  error_message            TEXT,
  created_at               TEXT NOT NULL,
  started_at               TEXT,
  completed_at             TEXT,
  updated_at               TEXT NOT NULL,
  UNIQUE (tenant_id, created_by, idempotency_key)
);

CREATE TABLE friend_daily_snapshots (
  -- JST の日付（YYYY-MM-DD）。LINEアカウントごとに1行。
  date              TEXT NOT NULL,
  -- どのLINEアカウントぶんか。全体の合計は line_account_id = '' で持つ。
  -- NULL にすると主キーに使えない（SQLite は NULL 同士を別物として扱う）。
  line_account_id   TEXT NOT NULL DEFAULT '',

  -- その日の終わりの状態。
  active            INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL DEFAULT 0,
  blocked_by_them   INTEGER NOT NULL DEFAULT 0,
  hidden_by_us      INTEGER NOT NULL DEFAULT 0,

  -- その日に増えた／減った数。差分は active の引き算でも出せるが、
  -- 記録が飛んだ日があると引き算が壊れるので、その日の実数も持つ。
  added             INTEGER NOT NULL DEFAULT 0,
  blocked           INTEGER NOT NULL DEFAULT 0,

  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),

  PRIMARY KEY (date, line_account_id)
);

CREATE TABLE friend_field_scopes (
  field_id         TEXT PRIMARY KEY REFERENCES friend_fields(id) ON DELETE CASCADE,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  line_account_id  TEXT REFERENCES line_accounts(id),
  created_at       TEXT NOT NULL
);

CREATE TABLE friend_field_values (
  friend_id   TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  field_id    TEXT NOT NULL REFERENCES friend_fields(id) ON DELETE CASCADE,
  value       TEXT,
  -- staff.id / 'form' / 'ec' / 'automation'。誰が入れた値かで扱いが変わる。
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (friend_id, field_id)
);

CREATE TABLE friend_fields (
  id             TEXT PRIMARY KEY,
  folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  -- 差し込み変数名。{pet_name} のように使うので、日本語・記号は入れない。
  -- 形の検証はAPI側（^[a-z][a-z0-9_]{0,31}$）。
  field_key      TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL CHECK (type IN (
                   'text','textarea','number','date','select',
                   'multi_select','checkbox','url','tel','email')),
  options_json   TEXT CHECK (options_json IS NULL OR json_valid(options_json)),
  default_value  TEXT,
  source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual','form','ec','automation')),
  -- EC連携時のマッピング元。ec_is_master が1なら EC 側を正とし、
  -- 管理画面からは書き換えさせない。
  ec_field_path  TEXT,
  ec_is_master   INTEGER NOT NULL DEFAULT 0,
  -- 本名・電話・住所など。閲覧を役割で絞り、開いたら記録を残す。
  is_personal    INTEGER NOT NULL DEFAULT 0,
  is_starred     INTEGER NOT NULL DEFAULT 0,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE friend_identity_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL REFERENCES identity_candidates(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  link_method TEXT NOT NULL,
  evidence_snapshot_json TEXT NOT NULL CHECK (json_valid(evidence_snapshot_json)),
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  linked_by TEXT,
  linked_at TEXT NOT NULL,
  unlinked_by TEXT,
  unlinked_at TEXT,
  unlink_reason TEXT
);

CREATE TABLE friend_reminder_deliveries (
  id                TEXT PRIMARY KEY,
  friend_reminder_id TEXT NOT NULL REFERENCES friend_reminders (id) ON DELETE CASCADE,
  reminder_step_id  TEXT NOT NULL REFERENCES reminder_steps (id) ON DELETE CASCADE,
  delivered_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (friend_reminder_id, reminder_step_id)
);

CREATE TABLE friend_reminders (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  target_date     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE "friend_scenarios" (
  id                 TEXT PRIMARY KEY,
  friend_id          TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  scenario_id        TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  current_step_order INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'delivering')) DEFAULT 'active',
  started_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  next_delivery_at   TEXT,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, previous_scenario_id TEXT);

CREATE TABLE friend_scores (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  scoring_rule_id TEXT REFERENCES scoring_rules (id) ON DELETE SET NULL,
  score_change    INTEGER NOT NULL,
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE friend_tags (
  friend_id   TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (friend_id, tag_id)
);

CREATE TABLE friends (
  id               TEXT PRIMARY KEY,
  line_user_id     TEXT UNIQUE NOT NULL,
  display_name     TEXT,
  picture_url      TEXT,
  status_message   TEXT,
  is_following     INTEGER NOT NULL DEFAULT 1,
  user_id          TEXT,
  ig_igsid         TEXT,
  score            INTEGER NOT NULL DEFAULT 0,
  last_ref_code    TEXT,
  last_ref_at      TEXT,
  first_followed_at TEXT,
  current_follow_started_at TEXT,
  last_followed_at TEXT,
  last_unfollowed_at TEXT,
  unfollow_count   INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, ref_code TEXT, metadata TEXT NOT NULL DEFAULT '{}', line_account_id TEXT REFERENCES line_accounts(id), first_tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL, support_mark_id TEXT REFERENCES support_marks(id) ON DELETE SET NULL, is_hidden INTEGER NOT NULL DEFAULT 0, real_name TEXT, system_display_name TEXT, private_memo TEXT);

CREATE TABLE funnel_steps (
  id         TEXT PRIMARY KEY,
  funnel_id  TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN (
               'tag','field','form','site_event','purchase','link_click','conversion')),
  match_json TEXT NOT NULL CHECK (json_valid(match_json)),
  UNIQUE (funnel_id, step_order)
);

CREATE TABLE funnels (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  segment_json TEXT CHECK (segment_json IS NULL OR json_valid(segment_json)),
  -- 何日以内に次の段へ進んだものを数えるか。
  window_days  INTEGER NOT NULL DEFAULT 30,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE);

CREATE TABLE google_calendar_connections (
  id            TEXT PRIMARY KEY,
  calendar_id   TEXT NOT NULL,
  line_account_id TEXT,
  staff_id      TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  api_key       TEXT,
  auth_type     TEXT NOT NULL DEFAULT 'api_key',
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_verified_at TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE identity_candidate_decisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES identity_candidates(id) ON DELETE RESTRICT,
  candidate_version INTEGER NOT NULL CHECK (candidate_version >= 2),
  from_status TEXT NOT NULL
    CHECK (from_status IN ('pending', 'linked', 'different', 'deferred', 'invalidated')),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('pending', 'linked', 'different', 'deferred', 'invalidated')),
  actor_staff_id TEXT,
  actor_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  impact_snapshot_json TEXT NOT NULL CHECK (json_valid(impact_snapshot_json)),
  reprocess_scope_json TEXT CHECK (reprocess_scope_json IS NULL OR json_valid(reprocess_scope_json)),
  decided_at TEXT NOT NULL,
  UNIQUE(candidate_id, candidate_version)
);

CREATE TABLE identity_candidates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('friend_duplicate', 'ec_member')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'linked', 'different', 'deferred', 'invalidated')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  detector_version TEXT NOT NULL,
  left_subject_kind TEXT NOT NULL CHECK (left_subject_kind IN ('friend', 'ec_event')),
  left_subject_id TEXT NOT NULL,
  left_line_account_id TEXT REFERENCES line_accounts(id) ON DELETE RESTRICT,
  left_shop_key TEXT,
  left_snapshot_json TEXT NOT NULL CHECK (json_valid(left_snapshot_json)),
  right_subject_kind TEXT NOT NULL CHECK (right_subject_kind = 'friend'),
  right_subject_id TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  right_line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  right_shop_key TEXT,
  right_snapshot_json TEXT NOT NULL CHECK (json_valid(right_snapshot_json)),
  source_key TEXT,
  external_customer_id TEXT,
  evidence_fingerprint TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  impact_json TEXT NOT NULL CHECK (json_valid(impact_json)),
  detected_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'friend_duplicate' AND left_subject_kind = 'friend'
      AND left_line_account_id IS NOT NULL AND left_subject_id < right_subject_id)
    OR
    (kind = 'ec_member' AND left_subject_kind = 'ec_event'
      AND left_line_account_id = right_line_account_id
      AND left_shop_key IS NOT NULL AND source_key IS NOT NULL
      AND external_customer_id IS NOT NULL)
  ),
  UNIQUE (
    tenant_id, kind, left_subject_kind, left_subject_id,
    right_subject_kind, right_subject_id
  )
);

CREATE TABLE identity_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES identity_candidates(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('candidate', 'link', 'unlink', 'profile', 'priority', 'migration')),
  summary TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  actor_staff_id TEXT,
  actor_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL
);

CREATE TABLE inbox_conversation_events (
  id              TEXT PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  conversation_id TEXT NOT NULL,
  event_type      TEXT NOT NULL
                  CHECK (event_type IN ('assignment', 'status', 'note', 'read', 'send', 'conflict', 'unsend')),
  before_json     TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json      TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  actor_staff_id  TEXT,
  reason          TEXT,
  correlation_id  TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE inbox_notes (
  id                    TEXT PRIMARY KEY,
  channel               TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  conversation_id       TEXT NOT NULL,
  body                  TEXT NOT NULL,
  created_by_staff_id   TEXT,
  correction_of_note_id TEXT REFERENCES inbox_notes (id) ON DELETE SET NULL,
  invalidation_reason   TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE inbox_reply_leases (
  channel               TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  conversation_id       TEXT NOT NULL,
  staff_id              TEXT NOT NULL,
  acquired_at           TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  conversation_revision INTEGER NOT NULL,
  PRIMARY KEY (channel, conversation_id)
);

CREATE TABLE inbox_staff_reads (
  staff_id        TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  conversation_id TEXT NOT NULL,
  last_read_at    TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (staff_id, channel, conversation_id)
);

CREATE TABLE incoming_webhooks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'custom',
  secret      TEXT,
  line_account_id TEXT REFERENCES line_accounts (id),
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE line_accounts (
  id                     TEXT PRIMARY KEY,
  channel_id             TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  channel_access_token   TEXT NOT NULL,
  channel_secret         TEXT NOT NULL,
  -- 172: AES-GCM encrypted values. Legacy plaintext columns remain during migration.
  channel_access_token_encrypted TEXT,
  channel_secret_encrypted       TEXT,
  is_active              INTEGER NOT NULL DEFAULT 1,
  country                TEXT,
  role                   TEXT,
  display_order          INTEGER NOT NULL DEFAULT 0,
  og_site_name           TEXT,
  og_default_image_url   TEXT,
  og_default_description TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, login_channel_id TEXT, login_channel_secret TEXT, liff_id TEXT, token_expires_at TEXT, friend_capacity INTEGER, capacity_warn_at INTEGER, icon_url TEXT, parent_line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL, tenant_id TEXT REFERENCES tenants(id), timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo');

CREATE TABLE line_webhook_events (
  webhook_event_id TEXT PRIMARY KEY,
  line_account_id  TEXT,
  event_type       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'processing', 'succeeded', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT CHECK (
                     last_error IS NULL OR
                     last_error IN ('line_api_error', 'db_error', 'unknown')
                   ),
  received_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE link_clicks (
  id TEXT PRIMARY KEY,
  tracked_link_id TEXT NOT NULL REFERENCES tracked_links (id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_audit (
  id            TEXT PRIMARY KEY,
  admin_user_id TEXT,
  action        TEXT NOT NULL CHECK (action IN ('login','logout','fail','view_personal','export')),
  screen        TEXT,
  ip            TEXT,
  user_agent    TEXT,
  result        TEXT NOT NULL DEFAULT 'ok',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  r2_key      TEXT NOT NULL UNIQUE,
  public_url  TEXT,
  uploaded_by TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE);

CREATE TABLE media_usages (
  media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  ref_kind   TEXT NOT NULL CHECK (ref_kind IN (
               'template','broadcast','rich_menu','scenario_step',
               'nen_column','event','webinar')),
  ref_id     TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (media_id, ref_kind, ref_id)
);

CREATE TABLE meet_callback_receipts (
  session_id   TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  received_at  TEXT NOT NULL
);

CREATE TABLE meet_consultation_reminders (
  id               TEXT PRIMARY KEY,
  consultation_id  TEXT NOT NULL REFERENCES meet_consultations (id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('day_before', 'hour_before')),
  scheduled_at     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'failed', 'sent', 'cancelled')),
  retry_count      INTEGER NOT NULL DEFAULT 0,
  sent_at          TEXT,
  last_error       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (consultation_id, kind)
);

CREATE TABLE meet_consultations (
  id                TEXT PRIMARY KEY,
  external_event_id TEXT NOT NULL UNIQUE,
  friend_id         TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  starts_at         TEXT NOT NULL,
  ends_at           TEXT NOT NULL,
  meet_url          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE menus (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category_label        TEXT,
  description           TEXT,
  duration_minutes      INTEGER NOT NULL,
  buffer_after_minutes  INTEGER NOT NULL DEFAULT 0,
  base_price            INTEGER NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  deleted_at            TEXT,
  auto_tag_id           TEXT,                  -- 予約申込時に friend に自動付与するタグ
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), concurrent_capacity INTEGER NOT NULL DEFAULT 1, booking_window_days INTEGER, cutoff_hours_before INTEGER, cancel_deadline_hours_before INTEGER, intake_question TEXT,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (auto_tag_id) REFERENCES tags(id) ON DELETE SET NULL
);

CREATE TABLE message_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'flex')),
  message_content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages_log (
  id               TEXT PRIMARY KEY,
  friend_id        TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type     TEXT NOT NULL,
  content          TEXT NOT NULL,
  broadcast_id     TEXT REFERENCES broadcasts (id) ON DELETE SET NULL,
  scenario_step_id TEXT REFERENCES scenario_steps (id) ON DELETE SET NULL,
  template_id_at_send TEXT,
  delivery_type    TEXT CHECK (delivery_type IN ('push', 'reply', 'test')),
  source           TEXT,
  line_account_id  TEXT,
  sent_by_staff_id TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, origin_kind TEXT, origin_id TEXT);

CREATE TABLE mileage_event_queue (
  engagement_event_id   TEXT PRIMARY KEY REFERENCES engagement_events(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','processed','failed')),
  attempts              INTEGER NOT NULL DEFAULT 0,
  available_at          TEXT NOT NULL,
  processing_started_at TEXT,
  processed_at          TEXT,
  last_error            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE mileage_ledger (
  id                    TEXT PRIMARY KEY,
  program_id            TEXT NOT NULL REFERENCES mileage_programs(id),
  beneficiary_user_id   TEXT REFERENCES users(id),
  beneficiary_friend_id TEXT REFERENCES friends(id),
  engagement_event_id   TEXT REFERENCES engagement_events(id),
  mileage_rule_id       TEXT REFERENCES mileage_rules(id),
  entry_type            TEXT NOT NULL
                        CHECK (entry_type IN ('grant','reversal','spend','expiration','adjustment')),
  status                TEXT NOT NULL DEFAULT 'available'
                        CHECK (status IN ('pending','available','void')),
  amount                INTEGER NOT NULL CHECK (amount != 0),
  reason                TEXT NOT NULL,
  source                TEXT NOT NULL,
  source_event_id       TEXT,
  idempotency_key       TEXT NOT NULL,
  reverses_entry_id     TEXT REFERENCES mileage_ledger(id),
  metadata              TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  occurred_at           TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  UNIQUE (program_id, idempotency_key)
);

CREATE TABLE mileage_programs (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','paused','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mileage_rules (
  id             TEXT PRIMARY KEY,
  program_id     TEXT NOT NULL REFERENCES mileage_programs(id),
  name           TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  source         TEXT,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  initial_status TEXT NOT NULL DEFAULT 'available'
                 CHECK (initial_status IN ('pending','available')),
  conditions     TEXT CHECK (conditions IS NULL OR json_valid(conditions)),
  is_active      INTEGER NOT NULL DEFAULT 1,
  valid_from     TEXT,
  valid_until    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE nen_birthday_coupon_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  code_prefix TEXT NOT NULL DEFAULT 'NENBDAY',
  benefit_label TEXT NOT NULL DEFAULT 'お誕生日月限定クーポン',
  discount_amount INTEGER NOT NULL DEFAULT 500 CHECK (discount_amount BETWEEN 1 AND 100000),
  validity_days INTEGER NOT NULL DEFAULT 31 CHECK (validity_days BETWEEN 1 AND 365),
  updated_at TEXT NOT NULL
);

CREATE TABLE nen_campaign_settings (
  campaign_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('transactional', 'follow_up', 'column', 'birthday')),
  trigger_event TEXT,
  delay_days INTEGER NOT NULL DEFAULT 0 CHECK (delay_days BETWEEN 0 AND 365),
  delivery_time TEXT NOT NULL DEFAULT '10:00',
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  title TEXT NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  button_label TEXT,
  button_url TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE nen_care_flags (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES nen_pet_profiles(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL CHECK (flag_type IN ('poor_appetite','abnormal_stool')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  consecutive_days INTEGER NOT NULL DEFAULT 0,
  advice_ready INTEGER NOT NULL DEFAULT 1 CHECK (advice_ready IN (0,1)),
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (pet_id, flag_type)
);

CREATE TABLE nen_columns (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT,
  excerpt TEXT NOT NULL DEFAULT '',
  article_url TEXT NOT NULL,
  image_url TEXT,
  published_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'draft' CHECK (delivery_status IN ('draft', 'scheduled', 'queued', 'sent')),
  delivery_at TEXT,
  line_account_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, intro_text TEXT);

CREATE TABLE nen_consultation_logs (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  pet_id TEXT REFERENCES nen_pet_profiles(id) ON DELETE SET NULL,
  topic TEXT NOT NULL CHECK (topic IN ('tear_stain','appetite','allergy')),
  answers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(answers_json)),
  result_key TEXT NOT NULL,
  result_text TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE nen_consultation_logs_v2 (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  pet_id TEXT REFERENCES nen_pet_profiles(id) ON DELETE SET NULL,
  animal_type TEXT NOT NULL DEFAULT 'dog' CHECK (animal_type IN ('dog','cat')),
  topic TEXT NOT NULL DEFAULT 'free_text',
  question_text TEXT NOT NULL DEFAULT '',
  answers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(answers_json)),
  result_key TEXT NOT NULL,
  result_text TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_ids_json)),
  safety_level TEXT NOT NULL DEFAULT 'general' CHECK (safety_level IN ('general','caution','urgent')),
  created_at TEXT NOT NULL
);

CREATE TABLE nen_coupon_issues (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES nen_pet_profiles(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  issue_year INTEGER NOT NULL,
  coupon_code TEXT NOT NULL UNIQUE,
  benefit_label TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  used_at TEXT,
  UNIQUE (pet_id, issue_year)
);

CREATE TABLE nen_delivery_jobs (
  id TEXT PRIMARY KEY,
  campaign_key TEXT NOT NULL REFERENCES nen_campaign_settings(campaign_key),
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id TEXT,
  source_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, campaign_snapshot TEXT CHECK (
  campaign_snapshot IS NULL OR json_valid(campaign_snapshot)
),
  UNIQUE (campaign_key, friend_id, source_key)
);

CREATE TABLE nen_ec_member_snapshots (
  friend_id TEXT PRIMARY KEY REFERENCES friends(id) ON DELETE CASCADE,
  customer_id TEXT,
  orders_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(orders_json)),
  subscription_json TEXT CHECK (subscription_json IS NULL OR json_valid(subscription_json)),
  purchase_count INTEGER NOT NULL DEFAULT 0,
  purchase_amount INTEGER NOT NULL DEFAULT 0,
  point_balance INTEGER NOT NULL DEFAULT 0,
  member_rank TEXT NOT NULL DEFAULT '会員',
  synced_at TEXT NOT NULL
);

CREATE TABLE nen_health_logs (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES nen_pet_profiles(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  logged_on TEXT NOT NULL,
  weight_kg REAL,
  stool_status TEXT NOT NULL CHECK (stool_status IN ('normal','soft','hard','diarrhea','bloody','other')),
  appetite TEXT NOT NULL CHECK (appetite IN ('good','normal','poor')),
  skin_status TEXT NOT NULL DEFAULT 'normal' CHECK (skin_status IN ('normal','itchy','red','other')),
  tear_stain_status TEXT NOT NULL DEFAULT 'normal' CHECK (tear_stain_status IN ('normal','mild','concern')),
  note TEXT NOT NULL DEFAULT '',
  care_flag INTEGER NOT NULL DEFAULT 0 CHECK (care_flag IN (0,1)),
  created_at TEXT NOT NULL, heart_rate_bpm INTEGER, respiratory_rate_bpm INTEGER,
  UNIQUE (pet_id, logged_on)
);

CREATE TABLE nen_knowledge_articles (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  animal_type TEXT NOT NULL CHECK (animal_type IN ('dog','cat','all')),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, source_kind TEXT NOT NULL DEFAULT 'commercial_editorial', authority_rank INTEGER NOT NULL DEFAULT 40, language TEXT NOT NULL DEFAULT 'ja', reviewed_at TEXT);

CREATE TABLE nen_pet_profiles (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  customer_id TEXT,
  name TEXT NOT NULL,
  animal_type TEXT NOT NULL DEFAULT 'dog' CHECK (animal_type IN ('dog', 'cat', 'other')),
  gender TEXT NOT NULL DEFAULT 'unknown' CHECK (gender IN ('male', 'female', 'unknown')),
  birthday TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, breed TEXT, weight_kg REAL, concerns TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(concerns)), recommended_daily_grams INTEGER, recommended_daily_min_grams INTEGER, recommended_daily_max_grams INTEGER, venison_daily_grams INTEGER, food_cycle_days INTEGER, image_r2_key TEXT, image_url TEXT);

CREATE TABLE nen_photo_review_events (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  from_status TEXT NOT NULL CHECK (from_status = 'pending'),
  to_status TEXT NOT NULL CHECK (to_status IN ('adopted', 'rejected')),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('quality', 'privacy', 'unrelated', 'duplicate', 'other')),
  reason_note TEXT,
  awarded_points INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT NOT NULL,
  reviewed_by_name TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed')),
  notification_error TEXT,
  notification_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (notification_attempt_count >= 0),
  notification_first_failed_at TEXT,
  notification_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(photo_id, from_status)
);

CREATE TABLE nen_photo_submissions (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL REFERENCES nen_pet_profiles(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','adopted','rejected')),
  awarded_points INTEGER NOT NULL DEFAULT 0,
  point_transaction_id TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL
, line_account_id TEXT REFERENCES line_accounts(id), publication_consent_version TEXT, publication_consent_at TEXT, publication_withdrawn_at TEXT, public_pet_name INTEGER NOT NULL DEFAULT 0
  CHECK (public_pet_name IN (0, 1)), review_reason_code TEXT
  CHECK (review_reason_code IS NULL OR review_reason_code IN ('quality', 'privacy', 'unrelated', 'duplicate', 'other')), review_reason_note TEXT, reviewed_by TEXT, reviewed_by_name TEXT, review_notification_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (review_notification_status IN ('not_required', 'pending', 'sent', 'failed')));

CREATE TABLE nen_point_ledger (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  external_ref TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE nen_rich_menu_jobs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  rich_menu_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE notification_rules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  conditions   TEXT NOT NULL DEFAULT '{}',
  channels     TEXT NOT NULL DEFAULT '["webhook"]',
  line_account_id TEXT REFERENCES line_accounts(id),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT REFERENCES notification_rules (id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  metadata        TEXT,
  line_account_id TEXT REFERENCES line_accounts(id),
  category        TEXT NOT NULL DEFAULT 'info' CHECK (category IN ('error', 'update', 'info')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE operation_audit (
  id            TEXT PRIMARY KEY,
  -- 何に対する操作か。'support_mark' | 'saved_search' | 'tag' など。
  target_kind   TEXT NOT NULL,
  target_id     TEXT,
  -- 何をしたか。'changed' | 'used' | 'created' | 'deleted' など。
  action        TEXT NOT NULL,
  -- 誰が。自動なら NULL。
  actor_id      TEXT,
  -- 対象の友だち。友だちに紐づかない操作なら NULL。
  friend_id     TEXT,
  -- 補足。変更前後の値など。JSON。
  detail_json   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE operators (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE outbound_send_requests (
  idempotency_key TEXT PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  resource_id     TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('in_progress', 'succeeded')),
  response_id     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE TABLE outgoing_webhooks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  event_types TEXT NOT NULL DEFAULT '[]',
  secret      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, max_retries INTEGER NOT NULL DEFAULT 0, consecutive_failures INTEGER NOT NULL DEFAULT 0, last_failed_at TEXT, line_account_id TEXT REFERENCES line_accounts(id));

CREATE TABLE pool_accounts (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES traffic_pools(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pool_id, line_account_id)
);

CREATE TABLE ref_tracking (
  id              TEXT PRIMARY KEY,
  ref_code        TEXT NOT NULL,
  friend_id       TEXT REFERENCES friends (id) ON DELETE CASCADE,
  entry_route_id  TEXT REFERENCES entry_routes (id) ON DELETE SET NULL,
  source_url      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
, fbclid TEXT, gclid TEXT, twclid TEXT, ttclid TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, user_agent TEXT, ip_address TEXT);

CREATE TABLE "reminder_steps" (
  id              TEXT PRIMARY KEY,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  offset_minutes  INTEGER NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN (
                    'text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel'
                  )),
  message_content TEXT NOT NULL,
  offset_days     INTEGER,
  send_at_time    TEXT,
  template_id     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE "reminders" (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  line_account_id TEXT,
  trigger_type  TEXT NOT NULL DEFAULT 'manual'
                CHECK (trigger_type IN ('manual', 'booking', 'event', 'friend_field')),
  trigger_offset_minutes INTEGER,
  send_at_time  TEXT,
  target_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  folder_id     TEXT REFERENCES folders(id) ON DELETE SET NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'countdown',
  -- 154: 友だち情報欄の日付を起点にするときの設定
  trigger_field_id TEXT,
  repeat_yearly INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, display_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE rich_menu_area_taps (
  id              TEXT PRIMARY KEY,
  area_id         TEXT NOT NULL,
  page_id         TEXT NOT NULL,
  group_id        TEXT NOT NULL,
  area_label      TEXT,
  friend_id       TEXT,
  line_account_id TEXT,
  tapped_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE rich_menu_areas (
  id              TEXT PRIMARY KEY,
  page_id         TEXT NOT NULL REFERENCES rich_menu_pages(id) ON DELETE CASCADE,
  bounds_x        INTEGER NOT NULL,
  bounds_y        INTEGER NOT NULL,
  bounds_width    INTEGER NOT NULL,
  bounds_height   INTEGER NOT NULL,
  action_type     TEXT NOT NULL CHECK (action_type IN ('uri','message','postback','richmenuswitch')),
  action_data     TEXT NOT NULL,
  -- 146: 運用者から見た「何をするボタンか」。LINE の action_type 4種の上に乗せる
  -- 言い換え（url / tel / text / template / form / switch / postback）。空なら
  -- action_type から推測する。
  intent          TEXT,
  label           TEXT,
  tag_ids         TEXT,
  score_change    INTEGER,
  template_id     TEXT,
  form_id         TEXT,
  tracked_link_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE rich_menu_groups (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  chat_bar_text      TEXT NOT NULL,
  size               TEXT NOT NULL CHECK (size IN ('large','compact')),
  default_page_id    TEXT,
  is_default_for_all INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  publishing_at      TEXT,
  -- 149: 友だちごとの出し分け。条件の形は一斉配信・シナリオと同じ
  -- （SegmentCondition の JSON）。priority は当てはまったときの順番で、
  -- 小さいほうが先。
  targeting_condition TEXT,
  targeting_priority  INTEGER NOT NULL DEFAULT 0,
  targeting_enabled   INTEGER NOT NULL DEFAULT 0,
  -- 159: フォルダで分ける。箱そのものは folders（kind='rich_menu'）。
  folder_id           TEXT REFERENCES folders(id) ON DELETE SET NULL,
  -- 160: 自分で決める並び順。小さいほど先。同じなら更新の新しい順。
  display_order       INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE rich_menu_pages (
  id                 TEXT PRIMARY KEY,
  group_id           TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  order_index        INTEGER NOT NULL,
  name               TEXT NOT NULL,
  alias_id           TEXT NOT NULL,
  line_richmenu_id   TEXT,
  image_r2_key       TEXT,
  image_content_type TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (group_id, order_index)
);

CREATE TABLE rt_approval_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES rt_stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('gbp_post', 'line_message', 'menu_change')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'scheduled', 'completed', 'returned')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT,
  reviewed_by TEXT,
  review_comment TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rt_connector_status (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('restaurant_board', 'reszaiko', 'hotpepper', 'tabelog', 'gurunavi', 'ikyu', 'retty', 'google_business_profile', 'line')),
  mode TEXT NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled', 'inbound_only')),
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('connected', 'warning', 'error', 'unconfigured', 'disabled')),
  last_synced_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, provider)
);

CREATE TABLE rt_email_digests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES rt_media(id),
  target_date TEXT NOT NULL,
  reported_count INTEGER NOT NULL CHECK (reported_count >= 0),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  inbound_email_id TEXT NOT NULL UNIQUE REFERENCES rt_inbound_emails(id)
);

CREATE TABLE rt_gbp_posts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  post_type TEXT NOT NULL CHECK (post_type IN ('standard', 'event', 'offer')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  media_url TEXT,
  cta_type TEXT CHECK (cta_type IN ('book', 'call', 'learn_more')),
  cta_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'scheduled', 'published')),
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rt_gbp_reviews (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  external_review_id TEXT NOT NULL,
  author_name TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  reviewed_at TEXT NOT NULL,
  reply_status TEXT NOT NULL DEFAULT 'unreplied' CHECK (reply_status IN ('unreplied', 'draft', 'approved', 'replied')),
  reply_draft TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, external_review_id)
);

CREATE TABLE rt_inbound_emails (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  store_id TEXT REFERENCES rt_stores(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'storing'
    CHECK (status IN ('storing', 'stored', 'received', 'quarantined', 'storage_failed', 'raw_deleted')),
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  quarantine_reason TEXT
);

CREATE TABLE rt_intake_addresses (
  id TEXT PRIMARY KEY,
  local_part TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE rt_inventory_slots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30)),
  total_capacity INTEGER NOT NULL CHECK (total_capacity >= 0),
  ota_capacity INTEGER NOT NULL DEFAULT 0 CHECK (ota_capacity >= 0),
  line_capacity INTEGER NOT NULL DEFAULT 0 CHECK (line_capacity >= 0),
  walk_in_capacity INTEGER NOT NULL DEFAULT 0 CHECK (walk_in_capacity >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, starts_at)
);

CREATE TABLE rt_line_flows (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES rt_stores(id) ON DELETE CASCADE,
  flow_type TEXT NOT NULL CHECK (flow_type IN ('reservation_24h', 'reservation_2h', 'post_visit', 'review_request', 'member_card', 'one_tap_booking')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  timing_minutes INTEGER,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  delivery_mode TEXT NOT NULL DEFAULT 'preview_only' CHECK (delivery_mode IN ('preview_only', 'disabled')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, store_id, flow_type)
);

CREATE TABLE rt_media (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('retty', 'gurunavi', 'tabelog', 'hotpepper')),
  name TEXT NOT NULL,
  sender_addresses TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sender_addresses)),
  parser_key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE rt_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES rt_stores(id) ON DELETE CASCADE,
  staff_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'store_manager', 'staff')),
  line_uid TEXT,
  google_email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rt_menu_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('course', 'a_la_carte')),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  tax_mode TEXT NOT NULL DEFAULT 'tax_included' CHECK (tax_mode IN ('tax_included', 'tax_excluded')),
  allergens_json TEXT NOT NULL DEFAULT '[]',
  service_periods_json TEXT NOT NULL DEFAULT '["dinner"]',
  duration_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rt_organization_agreements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  document_key TEXT NOT NULL,
  document_version TEXT NOT NULL,
  agreed_by_staff_id TEXT,
  agreed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, document_key, document_version)
);

CREATE TABLE rt_organizations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'test' CHECK (status IN ('test', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, tenant_id TEXT REFERENCES tenants(id));

CREATE TABLE rt_reservations (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('restaurant_board', 'reszaiko', 'hotpepper', 'tabelog', 'gurunavi', 'ikyu', 'retty', 'line', 'phone', 'manual')),
  external_id TEXT,
  hub_source TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  line_uid TEXT,
  guest_count INTEGER NOT NULL CHECK (guest_count > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  table_id TEXT REFERENCES rt_tables(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES rt_menu_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'seated', 'visited', 'cancelled', 'no_show')),
  allergy_note TEXT,
  note TEXT,
  sync_direction TEXT NOT NULL DEFAULT 'inbound_only' CHECK (sync_direction = 'inbound_only'),
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, media_id TEXT REFERENCES rt_media(id), hold_expires_at TEXT, cancel_reason TEXT, stay_minutes INTEGER, media_store_code TEXT, table_label TEXT, inbound_email_id TEXT REFERENCES rt_inbound_emails(id), parser_key TEXT, parser_version TEXT);

CREATE TABLE rt_resource_locks (
  resource_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rt_stores (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  area TEXT,
  capacity INTEGER NOT NULL DEFAULT 24 CHECK (capacity >= 0),
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  line_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (line_status IN ('connected', 'warning', 'error', 'unconfigured')),
  google_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (google_status IN ('connected', 'warning', 'error', 'unconfigured')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), line_account_id TEXT REFERENCES line_accounts(id),
  UNIQUE(organization_id, code)
);

CREATE TABLE rt_sync_events (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction = 'inbound'),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'duplicate', 'failed')),
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(store_id, provider, external_event_id)
);

CREATE TABLE rt_tables (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  seat_type TEXT NOT NULL CHECK (seat_type IN ('counter', 'table', 'private_room', 'terrace')),
  min_capacity INTEGER NOT NULL DEFAULT 1 CHECK (min_capacity > 0),
  max_capacity INTEGER NOT NULL CHECK (max_capacity >= min_capacity),
  floor_x INTEGER NOT NULL DEFAULT 0,
  floor_y INTEGER NOT NULL DEFAULT 0,
  join_group TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, code)
);

CREATE TABLE saved_search_references (
  saved_search_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  reference_kind TEXT NOT NULL
    CHECK (reference_kind IN ('broadcast','automation','scenario','other')),
  reference_id TEXT NOT NULL,
  reference_name TEXT NOT NULL,
  reference_mode TEXT NOT NULL DEFAULT 'live'
    CHECK (reference_mode IN ('live','fixed')),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (saved_search_id, reference_kind, reference_id),
  FOREIGN KEY (saved_search_id, line_account_id)
    REFERENCES saved_searches(id, line_account_id) ON DELETE RESTRICT
);

CREATE TABLE saved_searches (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'friends'
                    CHECK (scope IN ('friends','chats','bookings')),
  -- { all: [...], any: [...], visibility: '...' } の形。AND群とOR群の2グループ。
  conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json)),
  created_by      TEXT,
  is_shared       INTEGER NOT NULL DEFAULT 1,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE);

CREATE TABLE scenario_action_fires (
  action_id TEXT NOT NULL REFERENCES scenario_actions (id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  fired_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (action_id, friend_id)
);

CREATE TABLE scenario_actions (
  id               TEXT PRIMARY KEY,
  scenario_id      TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  -- どこで発火するか。
  --   step_sent          … その通を送ったあと
  --   scenario_completed … 最終コンテンツを配り終えたあと
  --   choice_selected    … 質問の選択肢が押されたとき
  hook             TEXT NOT NULL CHECK (hook IN ('step_sent', 'scenario_completed', 'choice_selected')),
  -- hook が step_sent / choice_selected のときだけ入る。
  step_id          TEXT REFERENCES scenario_steps (id) ON DELETE CASCADE,
  -- hook が choice_selected のときだけ入る。0 始まり。
  choice_index     INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  action_type      TEXT NOT NULL CHECK (action_type IN ('tag', 'friend_field', 'support_mark', 'scenario', 'common_var')),
  config_json      TEXT NOT NULL CHECK (json_valid(config_json)),
  -- 条件ビルダーの結果 (SegmentCondition)。NULL なら無条件。
  condition_json   TEXT CHECK (condition_json IS NULL OR json_valid(condition_json)),
  -- 0 なら、同じ友だちに対して1度しか実行しない。
  repeat_on_refire INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE "scenario_steps" (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  delay_minutes   INTEGER NOT NULL DEFAULT 0,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel')),
  message_content TEXT NOT NULL,
  message_bubbles_json TEXT CHECK (message_bubbles_json IS NULL OR json_valid(message_bubbles_json)),
  offset_days     INTEGER,
  offset_minutes  INTEGER,
  delivery_time   TEXT,
  template_id     TEXT REFERENCES templates(id) ON DELETE SET NULL,
  on_reach_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  condition_type  TEXT,
  condition_value TEXT,
  next_step_on_false INTEGER,
  after_send      TEXT NOT NULL DEFAULT 'continue' CHECK (after_send IN ('continue', 'pause')),
  target_condition_json TEXT,
  question_json   TEXT,
  is_draft        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scenario_id, step_order)
);

CREATE TABLE scenario_triggers (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('friend_add', 'tag_added')),
  -- kind が 'tag_added' のときだけ入る。
  tag_id      TEXT REFERENCES tags (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE scenarios (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('friend_add', 'tag_added', 'manual')),
  trigger_tag_id  TEXT REFERENCES tags (id) ON DELETE SET NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  delivery_mode   TEXT NOT NULL DEFAULT 'relative' CHECK (delivery_mode IN ('relative', 'elapsed', 'absolute_time')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, line_account_id TEXT, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0, allow_concurrent INTEGER NOT NULL DEFAULT 0, audience_condition_json TEXT, on_complete_mode TEXT NOT NULL DEFAULT 'pause', on_complete_scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL);

CREATE TABLE scoring_rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  score_value INTEGER NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE site_events (
  id          TEXT PRIMARY KEY,
  visitor_id  TEXT NOT NULL REFERENCES site_visitors(id) ON DELETE CASCADE,
  friend_id   TEXT REFERENCES friends(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN (
                'page_view','click','scroll_depth','custom','purchase')),
  path        TEXT,
  label       TEXT,
  value_num   INTEGER,
  referrer    TEXT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE site_visitors (
  id            TEXT PRIMARY KEY,
  friend_id     TEXT REFERENCES friends(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  linked_at     TEXT,
  linked_by     TEXT CHECK (linked_by IS NULL OR linked_by IN ('entry_route','liff','form','manual'))
);

CREATE TABLE staff (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL,
  name                     TEXT NOT NULL,
  display_name             TEXT NOT NULL,
  role                     TEXT,
  profile_image_url        TEXT,
  bio                      TEXT,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  is_designation_optional  INTEGER NOT NULL DEFAULT 0,
  is_active                INTEGER NOT NULL DEFAULT 1,
  deleted_at               TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);

CREATE TABLE staff_account_scopes (
  staff_id        TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (staff_id, line_account_id)
);

CREATE TABLE staff_availability_rules (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (staff_id, weekday),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE TABLE staff_members (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  access_level TEXT NOT NULL DEFAULT 'full' CHECK (access_level IN ('full', 'read_only')),
  api_key    TEXT UNIQUE NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  permission_keys TEXT NOT NULL DEFAULT '[]',
  notification_preferences TEXT NOT NULL DEFAULT '{}',
  invite_status TEXT NOT NULL DEFAULT 'active',
  invite_token_hash TEXT,
  invite_expires_at TEXT,
  email_verified_at TEXT,
  line_linked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, line_user_id TEXT, totp_secret_enc TEXT, totp_pending_secret_enc TEXT, totp_enabled_at TEXT, totp_last_used_step INTEGER, assigned_line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL, can_access_descendant_accounts INTEGER NOT NULL DEFAULT 0, tenant_id TEXT REFERENCES tenants(id), account_scope TEXT NOT NULL DEFAULT 'all'
  CHECK (account_scope IN ('all', 'accounts')));

CREATE TABLE staff_menus (
  staff_id                  TEXT NOT NULL,
  menu_id                   TEXT NOT NULL,
  is_offered                INTEGER NOT NULL DEFAULT 1,
  override_duration_minutes INTEGER,
  override_price            INTEGER,
  PRIMARY KEY (staff_id, menu_id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);

CREATE TABLE staff_notification_reads (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  staff_id        TEXT NOT NULL,
  read_at         TEXT NOT NULL,
  PRIMARY KEY (notification_id, staff_id)
);

CREATE TABLE staff_shifts (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  work_date   TEXT NOT NULL,    -- YYYY-MM-DD (JST)
  start_time  TEXT NOT NULL,    -- HH:MM (JST)
  end_time    TEXT NOT NULL,    -- HH:MM (JST)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (staff_id, work_date),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE TABLE stripe_events (
  id               TEXT PRIMARY KEY,
  stripe_event_id  TEXT NOT NULL UNIQUE,
  event_type       TEXT NOT NULL,
  friend_id        TEXT REFERENCES friends (id) ON DELETE SET NULL,
  amount           REAL,
  currency         TEXT,
  metadata         TEXT,
  processed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE "support_email_messages" (
  id                TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL REFERENCES "support_email_threads" (id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  sender_email      TEXT NOT NULL,
  sender_name       TEXT,
  recipient_email   TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body_text         TEXT NOT NULL,
  message_id        TEXT UNIQUE,
  in_reply_to       TEXT,
  references_header TEXT,
  sent_by_staff_id  TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE support_email_sync_state (
  mailbox TEXT PRIMARY KEY,
  uid_validity TEXT,
  last_uid INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE "support_email_threads" (
  id                       TEXT PRIMARY KEY,
  customer_email           TEXT NOT NULL,
  customer_name            TEXT,
  subject                  TEXT NOT NULL,
  normalized_subject       TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'unread'
                           CHECK (status IN ('unread', 'in_progress', 'on_hold', 'resolved')),
  assigned_staff_id        TEXT,
  last_message_at          TEXT NOT NULL,
  last_incoming_at         TEXT NOT NULL,
  last_outgoing_at         TEXT,
  resolved_at              TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  notes                    TEXT,
  revision                 INTEGER NOT NULL DEFAULT 0,
  last_customer_message_at TEXT,
  last_operator_message_at TEXT,
  next_response_due_at     TEXT
);

CREATE TABLE support_mark_scopes (
  mark_id         TEXT PRIMARY KEY REFERENCES support_marks(id),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT REFERENCES line_accounts(id),
  created_at      TEXT NOT NULL
);

CREATE TABLE support_marks (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#94A3B8',
  -- 新規友だちの初期値。1行だけ1にする（複数あってもアプリ側で最初の1件を使う）。
  is_default      INTEGER NOT NULL DEFAULT 0,
  -- 友だちから受信したとき自動でこれにする。
  auto_on_inbound INTEGER NOT NULL DEFAULT 0,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
, archived_at TEXT);

CREATE TABLE tag_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tags (
  id                          TEXT PRIMARY KEY,
  name                        TEXT UNIQUE NOT NULL,
  color                       TEXT NOT NULL DEFAULT '#3B82F6',
  mileage_reward              INTEGER NOT NULL DEFAULT 0 CHECK (mileage_reward >= 0),
  referral_mileage_reward     INTEGER NOT NULL DEFAULT 0 CHECK (referral_mileage_reward >= 0),
  mileage_multiplier_bps      INTEGER CHECK (mileage_multiplier_bps IS NULL OR mileage_multiplier_bps BETWEEN 1000 AND 100000),
  mileage_multiplier_priority INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, group_id TEXT REFERENCES tag_groups(id) ON DELETE SET NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, is_starred INTEGER NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0, line_account_id TEXT REFERENCES line_accounts(id));

CREATE TABLE templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'carousel')),
  message_content TEXT NOT NULL,
  -- 162: カルーセルの選択肢を押したときの動き。
  -- { "0": { "0": [アクションの並び] } }（パネル番号 → 選択肢番号 → 中身）
  carousel_actions_json TEXT,
  -- 162: 選択肢の押せる回数。'none'（制限なし）／'once'（全体で1回）
  carousel_tap_limit_mode TEXT NOT NULL DEFAULT 'none',
  -- 162: 制限を超えたときに返すテキスト。空なら何も返さない。
  carousel_tap_limit_text TEXT,
  -- 質問テンプレート。scenario_steps.question_json と同じ形。
  question_json TEXT CHECK (question_json IS NULL OR json_valid(question_json)),
  question_status TEXT NOT NULL DEFAULT 'published' CHECK (question_status IN ('draft', 'published')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0, line_account_id TEXT REFERENCES line_accounts(id));

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, feature_packs TEXT NOT NULL DEFAULT '[]');

CREATE TABLE tracked_links (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  original_url TEXT NOT NULL,
  tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  click_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, intro_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL, reward_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL, og_title TEXT, og_description TEXT, og_image_url TEXT, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL, short_code TEXT, dedup_key TEXT, template_id TEXT);

CREATE TABLE traffic_pools (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  active_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE update_history (
  id                          TEXT PRIMARY KEY,
  started_at                  INTEGER NOT NULL,
  completed_at                INTEGER,
  from_version                TEXT NOT NULL,
  to_version                  TEXT NOT NULL,
  status                      TEXT NOT NULL CHECK (status IN ('running','success','failed','rolled_back')),
  snapshot_worker_url         TEXT,
  snapshot_admin_deployment   TEXT,
  snapshot_liff_deployment    TEXT,
  events_jsonl                TEXT NOT NULL DEFAULT '',
  error                       TEXT,
  rollback_of                 TEXT REFERENCES update_history(id),
  rollback_expires_at         INTEGER
);

CREATE TABLE user_delivery_priorities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('broadcast', 'scenario', 'reminder', 'transactional', 'manual')),
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  priority INTEGER NOT NULL CHECK (priority >= 1),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  reason TEXT NOT NULL,
  selected_by TEXT,
  selected_at TEXT NOT NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_profile_values (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  value_preview TEXT,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('friend', 'friend_field', 'form', 'ec', 'manual')),
  source_id TEXT,
  source_label TEXT NOT NULL,
  source_friend_id TEXT REFERENCES friends(id) ON DELETE RESTRICT,
  verified_at TEXT,
  selected_by TEXT,
  selected_by_name TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  update_mode TEXT NOT NULL CHECK (update_mode IN ('auto', 'fixed')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT,
  phone        TEXT,
  external_id  TEXT,
  display_name TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, tenant_id TEXT REFERENCES tenants(id) ON DELETE RESTRICT, status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'review', 'archived')), primary_display_name TEXT, revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1), created_by TEXT, archived_at TEXT);

CREATE TABLE webinar_comments (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  at_seconds INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE webinar_ctas (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  at_seconds INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('form', 'url')),
  title TEXT NOT NULL,
  body TEXT,
  button_label TEXT NOT NULL,
  auto_open INTEGER NOT NULL DEFAULT 0,
  form_id TEXT REFERENCES forms(id),
  url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE webinar_followup_configs (
  webinar_id          TEXT PRIMARY KEY REFERENCES webinars(id) ON DELETE CASCADE,
  enabled_at          TEXT NOT NULL,
  first_delay_minutes INTEGER NOT NULL DEFAULT 30,
  second_delay_minutes INTEGER NOT NULL DEFAULT 1440,
  is_active           INTEGER NOT NULL DEFAULT 1
, stage_enabled_at TEXT, picker_delay_minutes INTEGER NOT NULL DEFAULT 30, no_show_delay_minutes INTEGER NOT NULL DEFAULT 30, booking_delay_minutes INTEGER NOT NULL DEFAULT 30, booking_second_delay_minutes INTEGER NOT NULL DEFAULT 1440, booking_menu_id TEXT, booking_url TEXT);

CREATE TABLE webinar_followups (
  id             TEXT PRIMARY KEY,
  webinar_id     TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id      TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('after_30m', 'after_24h')),
  retry_key      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at        TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (webinar_id, friend_id, kind)
);

CREATE TABLE webinar_funnel_events (
  id               TEXT PRIMARY KEY,
  webinar_id       TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  session_start_at INTEGER NOT NULL,
  event_type       TEXT NOT NULL CHECK (event_type IN (
    'cta_impression',
    'cta_click',
    'form_open',
    'form_start',
    'field_complete',
    'submit_attempt',
    'submit_success',
    'submit_error'
  )),
  cta_id           TEXT NOT NULL DEFAULT '',
  form_id          TEXT NOT NULL DEFAULT '',
  field_name       TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE webinar_journey_followups (
  id          TEXT PRIMARY KEY,
  webinar_id  TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id   TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN (
    'picker_no_registration',
    'registered_no_show',
    'submitted_no_booking_30m',
    'submitted_no_booking_24h'
  )),
  retry_key   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  sent_at     TEXT,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (webinar_id, friend_id, kind)
);

CREATE TABLE webinar_picker_opens (
  id              TEXT PRIMARY KEY,
  webinar_id      TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  opened_at       TEXT NOT NULL,
  UNIQUE (webinar_id, friend_id)
);

CREATE TABLE webinar_registrations (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  session_start_at INTEGER NOT NULL,
  notified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (webinar_id, friend_id, session_start_at)
);

CREATE TABLE webinar_user_comments (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  session_start_at INTEGER NOT NULL,
  at_seconds INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE webinar_viewers (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  session_start_at INTEGER NOT NULL,
  joined_at TEXT NOT NULL,
  last_position_seconds INTEGER NOT NULL DEFAULT 0,
  cta_clicked_at TEXT,
  UNIQUE (webinar_id, friend_id, session_start_at)
);

CREATE TABLE webinars (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES line_accounts(id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  video_prefix TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  schedule_json TEXT NOT NULL DEFAULT '[]',
  cta_json TEXT,
  tag_on_attend TEXT,
  tag_on_cta_click TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ad_conversion_logs_friend ON ad_conversion_logs (friend_id);

CREATE INDEX idx_ad_conversion_logs_platform ON ad_conversion_logs (ad_platform_id);

CREATE INDEX idx_ad_conversion_logs_status ON ad_conversion_logs (status);

CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions(expires_at);

CREATE INDEX idx_admin_sessions_restaurant_store
  ON admin_sessions(selected_restaurant_store_id)
  WHERE selected_restaurant_store_id IS NOT NULL;

CREATE INDEX idx_admin_sessions_staff_id ON admin_sessions(staff_id);

CREATE INDEX idx_admin_two_factor_challenges_expires
  ON admin_two_factor_challenges(expires_at);

CREATE INDEX idx_admin_two_factor_challenges_staff
  ON admin_two_factor_challenges(staff_id);

CREATE INDEX idx_affiliate_clicks_affiliate ON affiliate_clicks (affiliate_id);

CREATE INDEX idx_affiliate_links_affiliate ON affiliate_links (affiliate_id);

CREATE INDEX idx_affiliate_links_offer ON affiliate_links (offer_id);

CREATE UNIQUE INDEX idx_affiliates_friend ON affiliates (friend_id) WHERE friend_id IS NOT NULL;

CREATE INDEX idx_analytics_cross_members_selection
  ON analytics_cross_run_members(run_id, row_key, col_key, friend_id);

CREATE INDEX idx_analytics_cross_runs_account_time
  ON analytics_cross_runs(line_account_id, created_at DESC, id DESC);

CREATE INDEX idx_analytics_cross_runs_pending
  ON analytics_cross_runs(state, created_at, id);

CREATE INDEX idx_analytics_daily_metrics_account_date
  ON analytics_daily_metrics(line_account_id, metric_date DESC, metric_key);

CREATE INDEX idx_analytics_events_account_time
  ON analytics_events(line_account_id, occurred_at, id);

CREATE INDEX idx_analytics_events_account_type_time
  ON analytics_events(line_account_id, event_type, occurred_at, id);

CREATE INDEX idx_analytics_events_friend_time
  ON analytics_events(line_account_id, friend_id, occurred_at, id)
  WHERE friend_id IS NOT NULL;

CREATE INDEX idx_analytics_funnel_members_selection
  ON analytics_funnel_run_members(run_id, group_key, highest_step_order, state, friend_id);

CREATE INDEX idx_analytics_funnel_runs_account_time
  ON analytics_funnel_runs(line_account_id, created_at DESC, id DESC);

CREATE INDEX idx_analytics_funnel_versions_current
  ON analytics_funnel_versions(line_account_id, funnel_id, version_number DESC);

CREATE INDEX idx_analytics_reconciliation_account_time
  ON analytics_reconciliation_runs(line_account_id, completed_at DESC);

CREATE INDEX idx_analytics_result_audiences_expiry
  ON analytics_result_audiences(line_account_id, expires_at);

CREATE INDEX idx_analytics_saved_analyses_account
  ON analytics_saved_analyses(line_account_id, status, updated_at DESC, id DESC);

CREATE INDEX idx_analytics_saved_snapshots_history
  ON analytics_saved_analysis_snapshots(line_account_id, saved_analysis_id, created_at DESC, id DESC);

CREATE INDEX idx_analytics_saved_versions_current
  ON analytics_saved_analysis_versions(line_account_id, saved_analysis_id, version_number DESC);

CREATE INDEX idx_analytics_url_exposure_queue_due
  ON analytics_url_exposure_queue(status, available_at, created_at)
  WHERE status IN ('pending','failed');

CREATE INDEX idx_analytics_url_exposures_friend_time
  ON analytics_url_exposures(line_account_id, friend_id, sent_at)
  WHERE friend_id IS NOT NULL;

CREATE INDEX idx_analytics_url_exposures_link_time
  ON analytics_url_exposures(line_account_id, tracked_link_id, sent_at, friend_id);

CREATE INDEX idx_auto_replies_template_id ON auto_replies(template_id);

CREATE INDEX idx_auto_reply_hits_friend ON auto_reply_hits(auto_reply_id, friend_id);

CREATE INDEX idx_auto_reply_hits_rule   ON auto_reply_hits(auto_reply_id, hit_at);

CREATE INDEX idx_automation_definitions_account_status
  ON automation_definitions(line_account_id, status, priority DESC);

CREATE INDEX idx_automation_logs_automation ON automation_logs (automation_id);

CREATE UNIQUE INDEX idx_automation_run_steps_one_per_step
  ON automation_run_steps(automation_run_id, step_key);

CREATE INDEX idx_automation_run_steps_retry
  ON automation_run_steps(status, retry_at)
  WHERE status IN ('queued', 'waiting', 'failed');

CREATE INDEX idx_automation_run_steps_run
  ON automation_run_steps(automation_run_id, step_key, attempt_number);

CREATE INDEX idx_automation_runs_account_status_created
  ON automation_runs(line_account_id, status, created_at DESC);

CREATE INDEX idx_automation_runs_automation_created
  ON automation_runs(automation_id, created_at DESC);

CREATE INDEX idx_automation_runs_due
  ON automation_runs(status, resume_at, lease_expires_at)
  WHERE status IN ('queued', 'waiting', 'running');

CREATE INDEX idx_automation_runs_friend_created
  ON automation_runs(friend_id, created_at DESC);

CREATE INDEX idx_automation_runs_waiting
  ON automation_runs(status, resume_at)
  WHERE status = 'waiting';

CREATE INDEX idx_automation_versions_automation_status
  ON automation_versions(automation_id, status, version_number DESC);

CREATE INDEX idx_automations_active ON automations (is_active);

CREATE INDEX idx_automations_event ON automations (event_type);

CREATE INDEX idx_bookings_account_status_starts ON bookings (line_account_id, status, starts_at);

CREATE INDEX idx_bookings_friend_starts ON bookings (friend_id, starts_at DESC);

CREATE INDEX idx_bookings_staff_overlap ON bookings (staff_id, status, starts_at, block_ends_at);

CREATE INDEX idx_broadcast_insights_broadcast_id ON broadcast_insights(broadcast_id);

CREATE INDEX idx_broadcast_insights_status ON broadcast_insights(status);

CREATE INDEX idx_broadcast_message_assets_account_kind
  ON broadcast_message_assets(line_account_id, kind, updated_at DESC);

CREATE INDEX idx_broadcasts_status_lookup ON broadcasts (status);

CREATE INDEX idx_calendar_bookings_friend ON calendar_bookings (friend_id);

CREATE INDEX idx_calendar_bookings_start ON calendar_bookings (start_at);

CREATE INDEX idx_carousel_taps_action ON carousel_taps(template_id, column_index, action_index);

CREATE INDEX idx_carousel_taps_friend ON carousel_taps(template_id, friend_id);

CREATE INDEX idx_chats_friend_status_message ON chats (friend_id, status, last_message_at);

CREATE UNIQUE INDEX idx_chats_friend_unique ON chats (friend_id);

CREATE INDEX idx_chats_operator ON chats (operator_id);

CREATE INDEX idx_chats_status ON chats (status);

CREATE INDEX idx_codex_cloud_tasks_status
  ON codex_cloud_tasks(status, updated_at DESC);

CREATE INDEX idx_codex_cloud_tasks_thread
  ON codex_cloud_tasks(channel_id, thread_ts, detected_at DESC);

CREATE INDEX idx_common_action_bindings_action
  ON common_action_bindings(common_action_id, common_action_version_id);

CREATE INDEX idx_common_action_bindings_consumer
  ON common_action_bindings(line_account_id, consumer_type, consumer_id);

CREATE INDEX idx_common_action_versions_action_status
  ON common_action_versions(common_action_id, status, version_number DESC);

CREATE INDEX idx_common_actions_account_status
  ON common_actions(line_account_id, status, updated_at DESC);

CREATE INDEX idx_common_vars_account_name
  ON common_vars(line_account_id, name, id);

CREATE INDEX idx_conversion_events_affiliate ON conversion_events (affiliate_code);

CREATE INDEX idx_conversion_events_created_friend ON conversion_events(created_at, friend_id);

CREATE INDEX idx_conversion_events_friend ON conversion_events (friend_id);

CREATE INDEX idx_conversion_events_point ON conversion_events (conversion_point_id);

CREATE INDEX idx_cvs_pending
  ON common_var_schedules(var_id, effective_from) WHERE applied_at IS NULL;

CREATE INDEX idx_dashboard_preferences_account
  ON dashboard_preferences(line_account_id, updated_at DESC);

CREATE INDEX idx_ec_events_account_received ON ec_events(line_account_id, received_at DESC);

CREATE INDEX idx_ec_events_customer ON ec_events(customer_id, received_at DESC);

CREATE INDEX idx_ec_events_friend ON ec_events(friend_id, received_at DESC);

CREATE INDEX idx_ec_events_identity_pending
  ON ec_events(line_account_id, received_at DESC) WHERE status = 'identity_pending';

CREATE INDEX idx_ec_events_status_received ON ec_events(status, received_at);

CREATE UNIQUE INDEX idx_ec_identity_links_active_customer
  ON ec_identity_links(tenant_id, source_key, shop_key, external_customer_id)
  WHERE unlinked_at IS NULL;

CREATE INDEX idx_ec_identity_links_friend
  ON ec_identity_links(tenant_id, line_account_id, friend_id, linked_at DESC);

CREATE INDEX idx_engagement_events_actor_friend
  ON engagement_events(program_id, actor_friend_id, occurred_at DESC);

CREATE INDEX idx_engagement_events_actor_user
  ON engagement_events(program_id, actor_user_id, occurred_at DESC);

CREATE INDEX idx_engagement_events_source
  ON engagement_events(source, source_event_id);

CREATE INDEX idx_entry_route_genres_created
  ON entry_route_genres (created_at ASC);

CREATE INDEX idx_entry_routes_genre
  ON entry_routes (genre, created_at DESC);

CREATE INDEX idx_entry_routes_pool ON entry_routes (pool_id);

CREATE INDEX idx_entry_routes_ref ON entry_routes (ref_code);

CREATE INDEX idx_entry_routes_tenant
  ON entry_routes(tenant_id);

CREATE INDEX idx_event_booking_idempotency_expires ON event_booking_idempotency_keys (expires_at);

CREATE INDEX idx_event_booking_reminders_status_scheduled ON event_booking_reminders (status, scheduled_at);

CREATE INDEX idx_event_bookings_account_status_event ON event_bookings (line_account_id, status, event_id);

CREATE INDEX idx_event_bookings_friend_requested ON event_bookings (friend_id, requested_at DESC);

CREATE INDEX idx_event_bookings_identity_status
  ON event_bookings (event_id, identity_key, status);

CREATE INDEX idx_event_bookings_slot_status ON event_bookings (slot_id, status);

CREATE INDEX idx_event_slots_event_starts ON event_slots (event_id, starts_at);

CREATE INDEX idx_event_waitlist_slot_created
  ON event_waitlist(slot_id, status, created_at);

CREATE UNIQUE INDEX idx_event_waitlist_slot_identity
  ON event_waitlist(slot_id, identity_key);

CREATE INDEX idx_events_account_published_sort ON events (line_account_id, is_published, sort_order);

CREATE INDEX idx_ffv_field ON friend_field_values(field_id, value);

CREATE INDEX idx_folders_kind_order ON folders(kind, display_order);

CREATE INDEX idx_form_accounts_account
  ON form_accounts(line_account_id, form_id);

CREATE INDEX idx_form_opens_form ON form_opens (form_id, opened_at);

CREATE INDEX idx_form_submissions_form ON form_submissions (form_id);

CREATE INDEX idx_form_submissions_form_friend
  ON form_submissions (form_id, friend_id);

CREATE INDEX idx_form_submissions_friend ON form_submissions (friend_id);

CREATE INDEX idx_friend_add_candidates_expiry
  ON friend_add_attribution_candidates(status, expires_at);

CREATE INDEX idx_friend_add_candidates_match
  ON friend_add_attribution_candidates(line_account_id, friend_id, status, occurred_at DESC);

CREATE INDEX idx_friend_add_events_account_state
  ON friend_add_events(line_account_id, friend_kind, attribution_status, routing_status);

CREATE INDEX idx_friend_add_events_account_time
  ON friend_add_events(line_account_id, occurred_at DESC, id DESC);

CREATE INDEX idx_friend_add_events_friend
  ON friend_add_events(line_account_id, friend_id, occurred_at DESC);

CREATE UNIQUE INDEX idx_friend_add_routing_one_draft
  ON friend_add_routing_versions (line_account_id)
  WHERE status = 'draft';

CREATE UNIQUE INDEX idx_friend_add_routing_one_published
  ON friend_add_routing_versions (line_account_id)
  WHERE status = 'published';

CREATE INDEX idx_friend_add_routing_versions_status
  ON friend_add_routing_versions (line_account_id, status, version_number DESC);

CREATE INDEX idx_friend_bulk_run_items_work
  ON friend_bulk_run_items(run_id, status, retry_at, lease_expires_at, ordinal);

CREATE INDEX idx_friend_bulk_runs_actor
  ON friend_bulk_runs(tenant_id, created_by, created_at DESC);

CREATE INDEX idx_friend_bulk_runs_due
  ON friend_bulk_runs(status, scheduled_at, updated_at);

CREATE INDEX idx_friend_daily_snapshots_date
  ON friend_daily_snapshots (line_account_id, date);

CREATE INDEX idx_friend_field_scopes_account
  ON friend_field_scopes(tenant_id, line_account_id);

CREATE INDEX idx_friend_fields_order ON friend_fields(display_order, id);

CREATE UNIQUE INDEX idx_friend_identity_links_active_friend
  ON friend_identity_links(friend_id) WHERE unlinked_at IS NULL;

CREATE INDEX idx_friend_identity_links_user
  ON friend_identity_links(tenant_id, user_id, linked_at DESC);

CREATE INDEX idx_friend_reminders_friend ON friend_reminders (friend_id);

CREATE INDEX idx_friend_reminders_status ON friend_reminders (status);

CREATE INDEX idx_friend_scenarios_friend_id ON friend_scenarios (friend_id);

CREATE INDEX idx_friend_scenarios_next_delivery_at ON friend_scenarios (next_delivery_at);

CREATE INDEX idx_friend_scenarios_status ON friend_scenarios (status);

CREATE UNIQUE INDEX idx_friend_scenarios_unique ON friend_scenarios (friend_id, scenario_id) WHERE status != 'completed';

CREATE INDEX idx_friend_scores_created ON friend_scores (created_at);

CREATE INDEX idx_friend_scores_friend ON friend_scores (friend_id);

CREATE INDEX idx_friend_tags_tag_id ON friend_tags (tag_id);

CREATE INDEX idx_friends_account_created
  ON friends(line_account_id, created_at DESC);

CREATE INDEX idx_friends_follow_tenure ON friends(is_following, current_follow_started_at);

CREATE INDEX idx_friends_hidden_created ON friends(is_hidden, created_at DESC);

CREATE INDEX idx_friends_ig_igsid ON friends (ig_igsid);

CREATE INDEX idx_friends_line_user_id ON friends (line_user_id);

CREATE INDEX idx_friends_mark ON friends(support_mark_id);

CREATE INDEX idx_friends_user_id ON friends (user_id);

CREATE INDEX idx_funnels_line_account_created
  ON funnels(line_account_id, created_at DESC);

CREATE INDEX idx_google_calendar_connections_staff
  ON google_calendar_connections (line_account_id, staff_id, is_active);

CREATE INDEX idx_health_logs_account ON account_health_logs (line_account_id);

CREATE INDEX idx_idempotency_expires ON booking_idempotency_keys (expires_at);

CREATE INDEX idx_identity_candidate_decisions_history
  ON identity_candidate_decisions(candidate_id, decided_at DESC);

CREATE INDEX idx_identity_candidates_left_account
  ON identity_candidates(tenant_id, left_line_account_id, status);

CREATE INDEX idx_identity_candidates_review_queue
  ON identity_candidates(tenant_id, kind, status, detected_at DESC);

CREATE INDEX idx_identity_candidates_right_account
  ON identity_candidates(tenant_id, right_line_account_id, status);

CREATE INDEX idx_identity_events_candidate_history
  ON identity_events(tenant_id, candidate_id, occurred_at DESC);

CREATE INDEX idx_identity_events_user_history
  ON identity_events(tenant_id, user_id, occurred_at DESC);

CREATE UNIQUE INDEX idx_inbox_conversation_events_correlation
  ON inbox_conversation_events (correlation_id, event_type);

CREATE INDEX idx_inbox_conversation_events_lookup
  ON inbox_conversation_events (channel, conversation_id, created_at DESC);

CREATE INDEX idx_inbox_notes_lookup
  ON inbox_notes (channel, conversation_id, created_at ASC);

CREATE INDEX idx_inbox_reply_leases_expiry ON inbox_reply_leases (expires_at);

CREATE INDEX idx_inbox_staff_reads_conversation
  ON inbox_staff_reads (channel, conversation_id, staff_id);

CREATE INDEX idx_incoming_webhooks_line_account ON incoming_webhooks (line_account_id);

CREATE INDEX idx_line_accounts_display_order
  ON line_accounts (display_order, created_at);

CREATE INDEX idx_line_accounts_parent
  ON line_accounts(parent_line_account_id);

CREATE INDEX idx_line_accounts_tenant
  ON line_accounts(tenant_id);

CREATE INDEX idx_line_webhook_events_account
  ON line_webhook_events(line_account_id, received_at DESC);

CREATE INDEX idx_line_webhook_events_status
  ON line_webhook_events(status, received_at);

CREATE INDEX idx_link_clicks_friend ON link_clicks (friend_id);

CREATE INDEX idx_link_clicks_link ON link_clicks (tracked_link_id);

CREATE INDEX idx_login_audit_user ON login_audit(admin_user_id, created_at);

CREATE INDEX idx_media_account_created
  ON media(line_account_id, created_at DESC, id);

CREATE INDEX idx_media_kind ON media(kind, created_at DESC);

CREATE INDEX idx_meet_callback_receipts_received
  ON meet_callback_receipts(received_at);

CREATE INDEX idx_meet_consultation_reminders_due
  ON meet_consultation_reminders (status, scheduled_at);

CREATE INDEX idx_meet_consultations_friend ON meet_consultations (friend_id);

CREATE INDEX idx_meet_consultations_start ON meet_consultations (status, starts_at);

CREATE INDEX idx_menus_account_sort ON menus (line_account_id, sort_order);

CREATE INDEX idx_messages_account_direction_created ON messages_log(line_account_id, direction, created_at);

CREATE INDEX idx_messages_log_broadcast_id ON messages_log(broadcast_id);

CREATE INDEX idx_messages_log_created_at ON messages_log (created_at);

CREATE INDEX idx_messages_log_friend_direction_created ON messages_log (friend_id, direction, created_at);

CREATE INDEX idx_messages_log_friend_id ON messages_log (friend_id);

CREATE INDEX idx_messages_log_friend_source ON messages_log (friend_id, source);

CREATE INDEX idx_messages_log_origin
  ON messages_log (origin_kind, created_at);

CREATE INDEX idx_mileage_event_queue_due
  ON mileage_event_queue(status, available_at, created_at);

CREATE INDEX idx_mileage_ledger_friend
  ON mileage_ledger(program_id, beneficiary_friend_id, status, occurred_at DESC);

CREATE UNIQUE INDEX idx_mileage_ledger_one_reversal
  ON mileage_ledger(reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE INDEX idx_mileage_ledger_rule
  ON mileage_ledger(program_id, mileage_rule_id, occurred_at DESC);

CREATE INDEX idx_mileage_ledger_source
  ON mileage_ledger(program_id, source, source_event_id);

CREATE INDEX idx_mileage_ledger_user
  ON mileage_ledger(program_id, beneficiary_user_id, status, occurred_at DESC);

CREATE INDEX idx_mileage_rules_match
  ON mileage_rules(program_id, event_type, source, is_active);

CREATE INDEX idx_nen_care_flags_status ON nen_care_flags(status, detected_at DESC);

CREATE INDEX idx_nen_consultations_friend ON nen_consultation_logs(friend_id, created_at DESC);

CREATE INDEX idx_nen_consultations_v2_friend ON nen_consultation_logs_v2(friend_id, created_at DESC);

CREATE INDEX idx_nen_consultations_v2_safety ON nen_consultation_logs_v2(safety_level, created_at DESC);

CREATE INDEX idx_nen_delivery_jobs_due
  ON nen_delivery_jobs(status, scheduled_at);

CREATE INDEX idx_nen_delivery_jobs_friend
  ON nen_delivery_jobs(friend_id, created_at DESC);

CREATE INDEX idx_nen_health_logs_pet_date ON nen_health_logs(pet_id, logged_on DESC);

CREATE INDEX idx_nen_knowledge_animal ON nen_knowledge_articles(animal_type, is_active);

CREATE INDEX idx_nen_knowledge_authority
  ON nen_knowledge_articles(is_active, animal_type, authority_rank DESC);

CREATE INDEX idx_nen_member_rank ON nen_ec_member_snapshots(member_rank, purchase_amount DESC);

CREATE INDEX idx_nen_pet_profiles_birthday
  ON nen_pet_profiles(substr(birthday, 6, 2), friend_id);

CREATE INDEX idx_nen_pet_profiles_customer
  ON nen_pet_profiles(customer_id);

CREATE INDEX idx_nen_photo_review_events_account_created
  ON nen_photo_review_events(line_account_id, created_at DESC);

CREATE INDEX idx_nen_photo_review_events_notification
  ON nen_photo_review_events(notification_status, created_at)
  WHERE notification_status IN ('pending', 'failed');

CREATE INDEX idx_nen_photos_account_status
  ON nen_photo_submissions(line_account_id, status, created_at DESC);

CREATE INDEX idx_nen_photos_publication
  ON nen_photo_submissions(line_account_id, publication_consent_at, reviewed_at DESC)
  WHERE status = 'adopted' AND publication_withdrawn_at IS NULL;

CREATE INDEX idx_nen_photos_status ON nen_photo_submissions(status, created_at DESC);

CREATE INDEX idx_nen_point_ledger_friend_created
  ON nen_point_ledger(friend_id, created_at DESC);

CREATE INDEX idx_nen_rich_menu_jobs_status
  ON nen_rich_menu_jobs(status, created_at);

CREATE INDEX idx_notification_rules_account ON notification_rules(line_account_id, event_type, is_active);

CREATE INDEX idx_notifications_center ON notifications(line_account_id, category, created_at DESC);

CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE INDEX idx_notifications_status ON notifications (status);

CREATE INDEX idx_operation_audit_kind_date
  ON operation_audit (target_kind, created_at);

CREATE INDEX idx_outbound_send_requests_created
  ON outbound_send_requests(created_at);

CREATE INDEX idx_outgoing_webhooks_line_account
  ON outgoing_webhooks(line_account_id, is_active, updated_at DESC);

CREATE INDEX idx_ref_tracking_friend ON ref_tracking (friend_id);

CREATE INDEX idx_ref_tracking_friend_created ON ref_tracking(friend_id, created_at);

CREATE INDEX idx_ref_tracking_ref    ON ref_tracking (ref_code);

CREATE INDEX idx_ref_tracking_ref_created ON ref_tracking(ref_code, created_at);

CREATE INDEX idx_reminder_steps_by_reminder ON reminder_steps (reminder_id);

CREATE INDEX idx_reminders_display_order ON reminders(display_order, created_at);

CREATE INDEX idx_reminders_folder ON reminders(folder_id);

CREATE INDEX idx_reminders_status_scheduled ON booking_reminders (status, scheduled_at);

CREATE INDEX idx_rich_menu_area_taps_area  ON rich_menu_area_taps(area_id, tapped_at);

CREATE INDEX idx_rich_menu_area_taps_group ON rich_menu_area_taps(group_id, tapped_at);

CREATE INDEX idx_rich_menu_areas_page     ON rich_menu_areas(page_id);

CREATE INDEX idx_rich_menu_groups_account ON rich_menu_groups(account_id, status);

CREATE INDEX idx_rich_menu_pages_group    ON rich_menu_pages(group_id, order_index);

CREATE INDEX idx_rt_approvals_queue ON rt_approval_requests(organization_id, status, created_at DESC);

CREATE INDEX idx_rt_email_digests_store_date
  ON rt_email_digests (store_id, target_date, media_id);

CREATE INDEX idx_rt_gbp_reviews_store ON rt_gbp_reviews(store_id, reply_status, reviewed_at DESC);

CREATE INDEX idx_rt_inbound_emails_retention
  ON rt_inbound_emails (received_at, status);

CREATE INDEX idx_rt_inbound_emails_store
  ON rt_inbound_emails (store_id, received_at DESC);

CREATE INDEX idx_rt_intake_addresses_store
  ON rt_intake_addresses (store_id, status);

CREATE INDEX idx_rt_inventory_store_time ON rt_inventory_slots(store_id, starts_at);

CREATE INDEX idx_rt_memberships_org ON rt_memberships(organization_id, store_id, role);

CREATE INDEX idx_rt_menu_store ON rt_menu_items(store_id, status, kind);

CREATE INDEX idx_rt_org_agreements_org
  ON rt_organization_agreements(organization_id, document_key);

CREATE UNIQUE INDEX idx_rt_organizations_account ON rt_organizations(account_id);

CREATE INDEX idx_rt_organizations_tenant
  ON rt_organizations(tenant_id);

CREATE UNIQUE INDEX idx_rt_organizations_tenant_unique
  ON rt_organizations(tenant_id);

CREATE UNIQUE INDEX idx_rt_reservations_external
  ON rt_reservations(store_id, source, external_id);

CREATE INDEX idx_rt_reservations_timeline ON rt_reservations(store_id, starts_at, status);

CREATE UNIQUE INDEX idx_rt_stores_line_account
  ON rt_stores (line_account_id) WHERE line_account_id IS NOT NULL;

CREATE INDEX idx_rt_stores_org ON rt_stores(organization_id, status);

CREATE INDEX idx_rt_sync_events_recent ON rt_sync_events(store_id, received_at DESC);

CREATE INDEX idx_rt_tables_store ON rt_tables(store_id, is_active);

CREATE INDEX idx_saved_search_references_account
  ON saved_search_references(line_account_id, saved_search_id, reference_kind);

CREATE INDEX idx_saved_searches_account_scope
  ON saved_searches(line_account_id, scope, created_by, display_order);

CREATE UNIQUE INDEX idx_saved_searches_id_account
  ON saved_searches(id, line_account_id);

CREATE INDEX idx_saved_searches_scope ON saved_searches(scope, display_order);

CREATE INDEX idx_scenario_actions_lookup
  ON scenario_actions (scenario_id, hook, step_id, choice_index, sort_order);

CREATE INDEX idx_scenario_steps_scenario_lookup ON scenario_steps (scenario_id);

CREATE INDEX idx_scenario_triggers_lookup
  ON scenario_triggers (kind, tag_id);

CREATE UNIQUE INDEX idx_scenario_triggers_unique
  ON scenario_triggers (scenario_id, kind, COALESCE(tag_id, ''));

CREATE INDEX idx_scenarios_order ON scenarios (display_order);

CREATE INDEX idx_shifts_staff_date ON staff_shifts (staff_id, work_date);

CREATE INDEX idx_site_events_friend ON site_events(friend_id, occurred_at);

CREATE INDEX idx_site_events_path ON site_events(path, occurred_at);

CREATE INDEX idx_site_visitors_friend ON site_visitors(friend_id);

CREATE INDEX idx_staff_account_scopes_account
  ON staff_account_scopes(line_account_id);

CREATE INDEX idx_staff_account_sort ON staff (line_account_id, sort_order);

CREATE INDEX idx_staff_availability_rules_staff
  ON staff_availability_rules (staff_id, weekday, is_active);

CREATE UNIQUE INDEX idx_staff_members_api_key ON staff_members(api_key);

CREATE INDEX idx_staff_members_assigned_line_account
  ON staff_members(assigned_line_account_id);

CREATE INDEX idx_staff_members_invite_token ON staff_members(invite_token_hash);

CREATE UNIQUE INDEX idx_staff_members_line_user_id
  ON staff_members(line_user_id)
  WHERE line_user_id IS NOT NULL;

CREATE INDEX idx_staff_members_role ON staff_members(role);

CREATE INDEX idx_staff_members_tenant
  ON staff_members(tenant_id);

CREATE INDEX idx_staff_notification_reads_staff
  ON staff_notification_reads(staff_id, read_at DESC);

CREATE INDEX idx_stripe_events_friend ON stripe_events (friend_id);

CREATE INDEX idx_stripe_events_type ON stripe_events (event_type);

CREATE INDEX idx_support_email_messages_reply_lookup
  ON support_email_messages (message_id);

CREATE INDEX idx_support_email_messages_thread_created
  ON support_email_messages (thread_id, created_at ASC);

CREATE INDEX idx_support_email_threads_customer_subject
  ON support_email_threads (customer_email, normalized_subject, last_message_at DESC);

CREATE INDEX idx_support_email_threads_status_last
  ON support_email_threads (status, last_message_at DESC);

CREATE INDEX idx_support_mark_scopes_account
  ON support_mark_scopes(tenant_id, line_account_id);

CREATE INDEX idx_support_marks_active
  ON support_marks(archived_at, display_order, created_at);

CREATE INDEX idx_tag_groups_sort ON tag_groups(sort_order, id);

CREATE INDEX idx_tags_group ON tags(group_id, name);

CREATE INDEX idx_tags_line_account
  ON tags(line_account_id, display_order, id);

CREATE INDEX idx_tags_order ON tags (folder_id, display_order);

CREATE INDEX idx_templates_category ON templates (category);

CREATE INDEX idx_templates_line_account
  ON templates(line_account_id, display_order, id);

CREATE UNIQUE INDEX idx_tracked_links_dedup_key
  ON tracked_links (dedup_key) WHERE dedup_key IS NOT NULL;

CREATE UNIQUE INDEX idx_tracked_links_short_code
  ON tracked_links (short_code) WHERE short_code IS NOT NULL;

CREATE INDEX idx_tracked_links_template
  ON tracked_links (template_id);

CREATE INDEX idx_update_history_started ON update_history(started_at DESC);

CREATE UNIQUE INDEX idx_user_delivery_priorities_active_friend
  ON user_delivery_priorities(tenant_id, user_id, purpose, friend_id)
  WHERE retired_at IS NULL;

CREATE UNIQUE INDEX idx_user_delivery_priorities_active_order
  ON user_delivery_priorities(tenant_id, user_id, purpose, priority)
  WHERE retired_at IS NULL;

CREATE INDEX idx_user_delivery_priorities_lookup
  ON user_delivery_priorities(tenant_id, user_id, purpose, priority);

CREATE UNIQUE INDEX idx_user_profile_values_active_field
  ON user_profile_values(tenant_id, user_id, field_key) WHERE is_active = 1;

CREATE INDEX idx_user_profile_values_history
  ON user_profile_values(tenant_id, user_id, field_key, selected_at DESC);

CREATE INDEX idx_users_email ON users (email);

CREATE INDEX idx_users_external_id ON users (external_id);

CREATE INDEX idx_users_phone ON users (phone);

CREATE INDEX idx_users_tenant_status
  ON users(tenant_id, status, updated_at DESC);

CREATE INDEX idx_webinar_comments_webinar
  ON webinar_comments (webinar_id, at_seconds);

CREATE INDEX idx_webinar_ctas_webinar
  ON webinar_ctas (webinar_id, at_seconds);

CREATE INDEX idx_webinar_followups_status
  ON webinar_followups (status, updated_at);

CREATE UNIQUE INDEX idx_webinar_funnel_events_unique
  ON webinar_funnel_events (
    webinar_id, friend_id, session_start_at, event_type, cta_id, form_id, field_name
  );

CREATE INDEX idx_webinar_funnel_events_webinar_created
  ON webinar_funnel_events (webinar_id, created_at);

CREATE INDEX idx_webinar_journey_followups_status
  ON webinar_journey_followups (status, updated_at);

CREATE INDEX idx_webinar_picker_opens_opened
  ON webinar_picker_opens (webinar_id, opened_at);

CREATE INDEX idx_webinar_regs_due
  ON webinar_registrations (notified_at, session_start_at);

CREATE INDEX idx_webinar_regs_friend
  ON webinar_registrations (webinar_id, friend_id);

CREATE INDEX idx_webinar_user_comments_webinar
  ON webinar_user_comments (webinar_id, created_at);

CREATE INDEX idx_webinar_viewers_webinar
  ON webinar_viewers (webinar_id, session_start_at);

CREATE UNIQUE INDEX uq_google_calendar_connections_active_staff
  ON google_calendar_connections (staff_id)
  WHERE staff_id IS NOT NULL AND is_active = 1;

CREATE TRIGGER trg_analytics_cross_runs_completed_immutable
BEFORE UPDATE ON analytics_cross_runs
WHEN OLD.state IN ('available','partial','unavailable','failed')
BEGIN SELECT RAISE(ABORT, 'analytics_cross_run_immutable'); END;

CREATE TRIGGER trg_analytics_funnel_runs_completed_immutable
BEFORE UPDATE ON analytics_funnel_runs
WHEN OLD.state != 'pending'
BEGIN SELECT RAISE(ABORT, 'analytics_funnel_run_immutable'); END;

CREATE TRIGGER trg_analytics_funnel_versions_no_delete
BEFORE DELETE ON analytics_funnel_versions
BEGIN SELECT RAISE(ABORT, 'analytics_funnel_version_immutable'); END;

CREATE TRIGGER trg_analytics_funnel_versions_no_update
BEFORE UPDATE ON analytics_funnel_versions
BEGIN SELECT RAISE(ABORT, 'analytics_funnel_version_immutable'); END;

CREATE TRIGGER trg_analytics_result_audiences_cross_reference
BEFORE INSERT ON analytics_result_audiences
WHEN NEW.source_kind = 'cross'
 AND NOT EXISTS (
   SELECT 1 FROM analytics_cross_runs r
    WHERE r.id = NEW.source_result_id AND r.line_account_id = NEW.line_account_id
 )
BEGIN SELECT RAISE(ABORT, 'analytics_result_source_not_found'); END;

CREATE TRIGGER trg_analytics_result_audiences_funnel_reference
BEFORE INSERT ON analytics_result_audiences
WHEN NEW.source_kind = 'funnel'
 AND NOT EXISTS (
   SELECT 1 FROM analytics_funnel_runs r
    WHERE r.id = NEW.source_result_id AND r.line_account_id = NEW.line_account_id
 )
BEGIN SELECT RAISE(ABORT, 'analytics_result_source_not_found'); END;

CREATE TRIGGER trg_analytics_saved_snapshots_no_update
BEFORE UPDATE ON analytics_saved_analysis_snapshots
BEGIN SELECT RAISE(ABORT, 'analytics_saved_snapshot_immutable'); END;

CREATE TRIGGER trg_analytics_saved_snapshots_same_parent
BEFORE INSERT ON analytics_saved_analysis_snapshots
WHEN NOT EXISTS (
  SELECT 1
    FROM analytics_saved_analyses a
    JOIN analytics_saved_analysis_versions v
      ON v.id = NEW.analysis_version_id
     AND v.saved_analysis_id = a.id
     AND v.line_account_id = a.line_account_id
   WHERE a.id = NEW.saved_analysis_id
     AND a.line_account_id = NEW.line_account_id
)
BEGIN SELECT RAISE(ABORT, 'analytics_saved_parent_mismatch'); END;

CREATE TRIGGER trg_analytics_saved_versions_no_delete
BEFORE DELETE ON analytics_saved_analysis_versions
BEGIN SELECT RAISE(ABORT, 'analytics_saved_version_immutable'); END;

CREATE TRIGGER trg_analytics_saved_versions_no_update
BEFORE UPDATE ON analytics_saved_analysis_versions
BEGIN SELECT RAISE(ABORT, 'analytics_saved_version_immutable'); END;

CREATE TRIGGER trg_analytics_saved_versions_same_account
BEFORE INSERT ON analytics_saved_analysis_versions
WHEN NOT EXISTS (
  SELECT 1 FROM analytics_saved_analyses a
   WHERE a.id = NEW.saved_analysis_id AND a.line_account_id = NEW.line_account_id
)
BEGIN SELECT RAISE(ABORT, 'analytics_saved_parent_mismatch'); END;

CREATE TRIGGER trg_automation_published_version_immutable
BEFORE UPDATE ON automation_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published automation version is immutable'); END;

CREATE TRIGGER trg_automation_published_version_no_delete
BEFORE DELETE ON automation_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published automation version cannot be deleted'); END;

CREATE TRIGGER trg_automation_run_steps_no_delete
BEFORE DELETE ON automation_run_steps
BEGIN SELECT RAISE(ABORT, 'automation step history cannot be deleted'); END;

CREATE TRIGGER trg_automation_runs_no_delete
BEFORE DELETE ON automation_runs
BEGIN SELECT RAISE(ABORT, 'automation run history cannot be deleted'); END;

CREATE TRIGGER trg_common_action_published_version_immutable
BEFORE UPDATE ON common_action_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published common action version is immutable'); END;

CREATE TRIGGER trg_common_action_published_version_no_delete
BEFORE DELETE ON common_action_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published common action version cannot be deleted'); END;

CREATE TRIGGER trg_friend_add_routing_versions_immutable_delete
BEFORE DELETE ON friend_add_routing_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add routing versions cannot be deleted'); END;

CREATE TRIGGER trg_friend_add_routing_versions_immutable_update
BEFORE UPDATE OF line_account_id, version_number, definition_snapshot
ON friend_add_routing_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add routing versions are immutable'); END;

CREATE TRIGGER trg_friend_add_routing_versions_status_transition
BEFORE UPDATE OF status ON friend_add_routing_versions
WHEN OLD.status IN ('published', 'retired')
 AND NEW.status <> OLD.status
 AND NOT (OLD.status = 'published' AND NEW.status = 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add routing version status cannot move backwards'); END;

CREATE TRIGGER trg_messages_log_queue_url_exposure
AFTER INSERT ON messages_log
WHEN NEW.direction = 'outgoing'
 AND instr(NEW.content, '/t/') > 0
 AND COALESCE(
       NEW.line_account_id,
       (SELECT line_account_id FROM friends WHERE id = NEW.friend_id)
     ) IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO analytics_url_exposure_queue (
    message_id, line_account_id, status, attempts, available_at, created_at, updated_at
  ) VALUES (
    NEW.id,
    COALESCE(
      NEW.line_account_id,
      (SELECT line_account_id FROM friends WHERE id = NEW.friend_id)
    ),
    'pending', 0, NEW.created_at, NEW.created_at, NEW.created_at
  ); END;

-- Seed data required by tenant-aware inserts on a fresh database.
INSERT OR IGNORE INTO tenants (id, name) VALUES
  ('00000000-0000-4000-8000-000000000001', '既定の統括');
