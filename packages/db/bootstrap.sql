-- Generated from schema.sql + migrations by scripts/generate-bootstrap.mjs.
-- Do not edit manually. Run `pnpm --dir packages/db generate:bootstrap`.
CREATE TABLE account_handover_decisions (
  id              TEXT PRIMARY KEY,
  handover_id     TEXT NOT NULL REFERENCES account_handovers(id) ON DELETE CASCADE,
  -- 引き継ぎ元の友だち。
  from_friend_id  TEXT NOT NULL,
  -- 結びつける先。link のときだけ入る。
  to_friend_id    TEXT,
  /*
    決めたこと。
      link … 同じ人として結びつける
      new  … 別人として新しく作る
      skip … 引き継がない
  */
  decision        TEXT NOT NULL CHECK (decision IN ('link','new','skip')),
  -- 事前確認がどの区分に入れたか。人が覆した記録を残すため。
  bucket          TEXT NOT NULL CHECK (bucket IN ('auto','review','unmatched','lookalike')),
  note            TEXT,
  decided_by      TEXT,
  decided_at      TEXT NOT NULL,
  UNIQUE (handover_id, from_friend_id)
);

CREATE TABLE account_handovers (
  id                  TEXT PRIMARY KEY,
  -- 引き継ぎ元。コードを出した側。
  from_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  -- 引き継ぎ先。コードを読んだ側。読まれるまでは null。
  to_account_id       TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  -- 段1で出すコード。読まれたあとも記録として残す。
  code                TEXT NOT NULL UNIQUE,
  code_expires_at     TEXT NOT NULL,
  /*
    段。設計の5段に対応する。
      code_issued … 1 コードを出した
      linked      … 2 受け取り先で読んだ
      previewed   … 3 事前確認が終わった
      resolved    … 4 競合の判断が終わった
      executing   … 5 本実行の最中
      completed   … 5 本実行と照合が終わった
    途中でやめたときは cancelled、失敗したときは failed。
  */
  status              TEXT NOT NULL DEFAULT 'code_issued'
                        CHECK (status IN ('code_issued','linked','previewed','resolved',
                                          'executing','completed','failed','cancelled')),
  /*
    プロバイダーが同じか。**分からないことを「同じ」と書かない。**
    どちらかの provider_id が入っていなければ unknown。
  */
  provider_match      TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (provider_match IN ('same','different','unknown')),
  /*
    事前確認の結果。**4区分の合計が source_friend_total と必ず合う。**
    合わないと、どこかの人が消えたように見える。まだ確認していない間は null。
  */
  source_friend_total INTEGER,
  auto_count          INTEGER,
  review_count        INTEGER,
  unmatched_count     INTEGER,
  lookalike_count     INTEGER,
  -- 本実行の進み。照合はこの2つを突き合わせて出す。
  moved_count         INTEGER NOT NULL DEFAULT 0,
  failed_count        INTEGER NOT NULL DEFAULT 0,
  failure_reason      TEXT,
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  linked_at           TEXT,
  previewed_at        TEXT,
  resolved_at         TEXT,
  executed_at         TEXT,
  completed_at        TEXT
);

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

CREATE TABLE action_score_rule_sets (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL UNIQUE REFERENCES line_accounts(id),
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'stopped')),
  current_draft_version_id     TEXT REFERENCES action_score_rule_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES action_score_rule_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE action_score_rule_versions (
  id               TEXT PRIMARY KEY,
  rule_set_id      TEXT NOT NULL REFERENCES action_score_rule_sets(id),
  version_number   INTEGER NOT NULL CHECK (version_number > 0),
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published')),
  rules_json       TEXT NOT NULL DEFAULT '[]',
  min_score        INTEGER NOT NULL DEFAULT 0,
  max_score        INTEGER NOT NULL DEFAULT 100,
  normal_min       INTEGER NOT NULL DEFAULT 30,
  high_min         INTEGER NOT NULL DEFAULT 70,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  published_by     TEXT,
  published_at     TEXT,
  UNIQUE (rule_set_id, version_number),
  CHECK (min_score >= 0),
  CHECK (max_score > min_score),
  CHECK (normal_min > min_score AND normal_min < high_min),
  CHECK (high_min < max_score)
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

CREATE TABLE affiliate_adjustments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  source_entry_id TEXT REFERENCES affiliate_reward_entries(id),
  applied_settlement_id TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  reason_type TEXT NOT NULL CHECK (reason_type IN ('refund', 'cancel', 'manual')),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied')),
  idempotency_key TEXT NOT NULL UNIQUE,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE affiliate_bank_profiles (
  affiliate_id TEXT PRIMARY KEY REFERENCES affiliates(id),
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('ordinary', 'checking')),
  account_number_encrypted TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  account_fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_idempotency_key TEXT NOT NULL,
  last_request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id, line_account_id, last_idempotency_key)
);

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

CREATE TABLE affiliate_payout_batch_lines (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES affiliate_payout_batches(id),
  settlement_line_id TEXT NOT NULL REFERENCES affiliate_settlement_lines(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  amount_minor INTEGER NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('ordinary', 'checking')),
  account_number_encrypted TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (batch_id, settlement_line_id)
);

CREATE TABLE affiliate_payout_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  settlement_id TEXT NOT NULL REFERENCES affiliate_settlements(id),
  total_amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  line_count INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('created', 'approved', 'exported', 'imported')),
  bank_format TEXT,
  file_checksum TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  exported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, version INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT, request_fingerprint TEXT, export_object_key TEXT, export_expires_at TEXT, download_token_hash TEXT, export_idempotency_key TEXT, export_request_fingerprint TEXT);

CREATE TABLE affiliate_payout_results (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES affiliate_payout_batches(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  settlement_line_id TEXT NOT NULL REFERENCES affiliate_settlement_lines(id),
  paid_amount_minor INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('paid', 'failed', 'returned')),
  external_reference TEXT,
  imported_by TEXT NOT NULL,
  paid_at TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE affiliate_reward_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  conversion_event_id TEXT NOT NULL REFERENCES conversion_events(id),
  offer_id TEXT REFERENCES affiliate_offers(id),
  offer_version_id TEXT,
  reward_calculation_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('credit', 'debit')),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'held', 'payable', 'settled', 'paid', 'reversed')),
  approved_at TEXT,
  payable_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (conversion_event_id, entry_type)
);

CREATE TABLE affiliate_settlement_lines (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES affiliate_settlements(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  entry_id TEXT REFERENCES affiliate_reward_entries(id),
  adjustment_id TEXT REFERENCES affiliate_adjustments(id),
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'included' CHECK (status IN ('included', 'withheld')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((entry_id IS NOT NULL AND adjustment_id IS NULL) OR (entry_id IS NULL AND adjustment_id IS NOT NULL))
);

CREATE TABLE affiliate_settlements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT REFERENCES affiliates(id),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  total_amount_minor INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('preview', 'closed', 'exported', 'paid', 'partial', 'failed')),
  closed_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, request_fingerprint TEXT NOT NULL DEFAULT '');

CREATE TABLE affiliate_statements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  settlement_id TEXT NOT NULL REFERENCES affiliate_settlements(id),
  total_amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generated', 'expired', 'revoked')),
  version INTEGER NOT NULL DEFAULT 1,
  pdf_object_key TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, idempotency_key TEXT, request_fingerprint TEXT, snapshot_json TEXT NOT NULL DEFAULT '{}', file_checksum TEXT);

CREATE TABLE affiliates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  commission_rate REAL NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  friend_id       TEXT REFERENCES friends (id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, email TEXT, hold_days INTEGER, payout_cycle TEXT, notify_on_conversion INTEGER NOT NULL DEFAULT 0, tenant_id TEXT REFERENCES tenants(id), line_account_id TEXT REFERENCES line_accounts(id), lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('active', 'paused', 'archived')), archived_at TEXT);

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

CREATE TABLE analytics_projection_friend_stage (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  cycle_id        TEXT NOT NULL,
  metric_date     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  friend_id       TEXT NOT NULL,
  PRIMARY KEY (line_account_id, cycle_id, metric_date, event_type, friend_id)
);

CREATE TABLE analytics_projection_metric_stage (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  cycle_id        TEXT NOT NULL,
  metric_date     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  event_count     INTEGER NOT NULL,
  unique_friend_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (line_account_id, cycle_id, metric_date, event_type)
);

CREATE TABLE analytics_projection_progress (
  line_account_id   TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  cycle_id          TEXT NOT NULL,
  range_from        TEXT NOT NULL,
  range_to          TEXT NOT NULL,
  time_zone         TEXT NOT NULL,
  data_cutoff_at    TEXT NOT NULL,
  broad_from        TEXT NOT NULL,
  broad_to          TEXT NOT NULL,
  last_occurred_at  TEXT NOT NULL DEFAULT '',
  last_event_id     TEXT NOT NULL DEFAULT '',
  source_event_count INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL
, phase TEXT NOT NULL DEFAULT 'scan');

CREATE TABLE analytics_projection_scheduler_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_account_id TEXT NOT NULL DEFAULT '',
  updated_at      TEXT NOT NULL
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

CREATE TABLE analytics_report_runs (
  id                         TEXT PRIMARY KEY,
  schedule_id                TEXT NOT NULL REFERENCES analytics_report_schedules(id) ON DELETE CASCADE,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  scheduled_for              TEXT NOT NULL,
  period_from                TEXT NOT NULL,
  period_to                  TEXT NOT NULL,
  time_zone                  TEXT NOT NULL,
  data_cutoff_at             TEXT NOT NULL,
  state                      TEXT NOT NULL CHECK (state IN ('running','available','partial','unavailable','failed')),
  result_json                TEXT NOT NULL CHECK (json_valid(result_json)),
  delivery_results_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(delivery_results_json)),
  error_code                 TEXT,
  started_at                 TEXT NOT NULL,
  completed_at               TEXT,
  UNIQUE (schedule_id, scheduled_for)
);

CREATE TABLE analytics_report_schedules (
  id                         TEXT PRIMARY KEY,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                       TEXT NOT NULL,
  sections_json              TEXT NOT NULL CHECK (json_valid(sections_json)),
  saved_analysis_ids_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(saved_analysis_ids_json)),
  cadence                    TEXT NOT NULL CHECK (cadence IN ('weekly','monthly')),
  weekday                    INTEGER CHECK (weekday BETWEEN 0 AND 6),
  month_day                  INTEGER CHECK (month_day BETWEEN 1 AND 28),
  send_time                  TEXT NOT NULL CHECK (send_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  time_zone                  TEXT NOT NULL,
  period_days                INTEGER NOT NULL CHECK (period_days BETWEEN 1 AND 397),
  recipients_json            TEXT NOT NULL CHECK (json_valid(recipients_json)),
  channels_json              TEXT NOT NULL CHECK (json_valid(channels_json)),
  alert_rules_json           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alert_rules_json)),
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  is_one_time                INTEGER NOT NULL DEFAULT 0 CHECK (is_one_time IN (0,1)),
  next_run_at                TEXT NOT NULL,
  created_by                 TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  CHECK ((cadence = 'weekly' AND weekday IS NOT NULL AND month_day IS NULL)
      OR (cadence = 'monthly' AND month_day IS NOT NULL AND weekday IS NULL))
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

CREATE TABLE audit_events (
  id                 TEXT PRIMARY KEY,
  source_kind        TEXT,
  source_id          TEXT,
  tenant_id          TEXT NOT NULL,
  line_account_id    TEXT,
  category           TEXT NOT NULL CHECK (category IN ('auth', 'business')),
  actor_principal_id TEXT,
  actor_role         TEXT,
  action             TEXT NOT NULL,
  target_kind        TEXT,
  target_id          TEXT,
  result             TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failed')),
  before_json        TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json         TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  reason             TEXT,
  request_trace_id   TEXT,
  ip_prefix          TEXT,
  device_family      TEXT,
  risk_level         TEXT NOT NULL DEFAULT 'normal'
                     CHECK (risk_level IN ('normal', 'suspicious', 'high')),
  retention_class    TEXT NOT NULL DEFAULT 'general'
                     CHECK (retention_class IN ('general', 'security', 'personal_data')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE SET NULL,
  UNIQUE (source_kind, source_id)
);

CREATE TABLE auth_step_up_attempts (
  staff_id          TEXT PRIMARY KEY,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);

CREATE TABLE auth_step_up_grants (
  token_hash  TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
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
  CHECK (friend_conditions_json IS NULL OR json_valid(friend_conditions_json)), lifecycle_status TEXT NOT NULL DEFAULT 'published'
  CHECK (lifecycle_status IN ('draft', 'published', 'stopped')), current_draft_version_id TEXT, current_published_version_id TEXT, created_from_recipe_id TEXT REFERENCES recipes(id), recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id));

CREATE TABLE auto_reply_action_runs (
  id                  TEXT PRIMARY KEY,
  evaluation_id       TEXT NOT NULL,
  action_stable_id    TEXT NOT NULL,
  action_version      INTEGER NOT NULL DEFAULT 1,
  action_type         TEXT NOT NULL,
  action_snapshot     TEXT NOT NULL CHECK (json_valid(action_snapshot)),
  idempotency_key     TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'claimed', 'succeeded', 'skipped',
      'retry_wait', 'permanent_failed', 'cancelled'
    )),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_error_code     TEXT,
  result_json         TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  started_at          TEXT,
  completed_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (evaluation_id, action_stable_id)
);

CREATE TABLE auto_reply_evaluation_details (
  id                 TEXT PRIMARY KEY,
  evaluation_id      TEXT NOT NULL,
  auto_reply_id      TEXT NOT NULL,
  rule_version_id    TEXT,
  evaluation_order   INTEGER NOT NULL,
  result             TEXT NOT NULL CHECK (result IN ('not_matched', 'skipped', 'won')),
  reason_codes_json  TEXT NOT NULL CHECK (json_valid(reason_codes_json)),
  created_at         TEXT NOT NULL,
  UNIQUE (evaluation_id, auto_reply_id)
);

CREATE TABLE auto_reply_evaluations (
  id                       TEXT PRIMARY KEY,
  incoming_event_id        TEXT NOT NULL UNIQUE,
  incoming_message_log_id  TEXT,
  line_account_id          TEXT,
  friend_id                TEXT NOT NULL,
  message_kind             TEXT NOT NULL,
  normalized_text_hash     TEXT NOT NULL,
  input_preview_masked     TEXT,
  evaluated_at             TEXT NOT NULL,
  completed_at             TEXT,
  winning_auto_reply_id    TEXT,
  winning_version_id       TEXT,
  status                   TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN (
      'received', 'evaluated', 'matched', 'skipped', 'reply_accepted',
      'reply_failed', 'actions_running', 'completed', 'partial_failed', 'failed'
    )),
  skip_reason              TEXT,
  matched_keyword          TEXT,
  reply_status             TEXT NOT NULL DEFAULT 'not_attempted'
    CHECK (reply_status IN ('not_attempted', 'accepted', 'failed')),
  line_request_id          TEXT,
  message_log_id           TEXT,
  action_summary           TEXT CHECK (action_summary IS NULL OR json_valid(action_summary)),
  error_code               TEXT,
  duration_ms              INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE TABLE auto_reply_hits (
  id              TEXT PRIMARY KEY,
  auto_reply_id   TEXT NOT NULL,
  friend_id       TEXT,
  line_account_id TEXT,
  matched_keyword TEXT,
  hit_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE auto_reply_versions (
  id                    TEXT PRIMARY KEY,
  auto_reply_id         TEXT NOT NULL,
  version_number        INTEGER NOT NULL,
  line_account_id       TEXT,
  definition_snapshot   TEXT NOT NULL CHECK (json_valid(definition_snapshot)),
  status                TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'retired')),
  published_at          TEXT,
  published_by_staff_id TEXT,
  created_at            TEXT NOT NULL, last_test_status TEXT
  CHECK (last_test_status IN ('succeeded', 'failed')), last_tested_at TEXT, last_tested_by_staff_id TEXT, publish_idempotency_key TEXT, updated_at TEXT,
  UNIQUE (auto_reply_id, version_number)
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

CREATE TABLE booking_availability_exceptions (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('store', 'staff', 'resource')),
  scope_id TEXT,
  date_from TEXT NOT NULL CHECK (date_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  date_to TEXT NOT NULL CHECK (date_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('closed', 'custom_hours', 'open')),
  hours_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  CHECK (date_from <= date_to),
  CHECK ((scope_kind = 'store' AND scope_id IS NULL) OR (scope_kind != 'store' AND length(trim(scope_id)) > 0)),
  CHECK ((kind = 'closed' AND hours_json = '[]') OR kind != 'closed')
);

CREATE TABLE booking_business_hours (
  id TEXT PRIMARY KEY,
  booking_settings_id TEXT NOT NULL REFERENCES booking_settings(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL CHECK (
    start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(start_time, 1, 2) <= '23'
  ),
  end_time TEXT NOT NULL CHECK (
    end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(end_time, 1, 2) <= '23'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), capacity INTEGER NOT NULL DEFAULT 1
  CHECK (capacity BETWEEN 1 AND 1000),
  CHECK (start_time < end_time),
  UNIQUE (booking_settings_id, weekday, start_time, end_time)
);

CREATE TABLE booking_customers (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id             TEXT REFERENCES friends(id) ON DELETE SET NULL,
  display_name          TEXT NOT NULL,
  phone_normalized_hash TEXT NOT NULL,
  phone_encrypted       TEXT NOT NULL,
  phone_last4           TEXT NOT NULL,
  email_encrypted       TEXT,
  pet_name              TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE booking_idempotency_keys (
  key              TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL,
  friend_id        TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT NOT NULL                  -- UTC ISO8601
);

CREATE TABLE booking_menu_resources (
  menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES booking_resources(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (menu_id, resource_id)
);

CREATE TABLE booking_operation_runs (
  id              TEXT PRIMARY KEY,
  booking_id      TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'confirmation_line', 'google_calendar', 'conversion',
                    'mileage', 'automation'
                  )),
  status          TEXT NOT NULL CHECK (status IN (
                    'queued', 'succeeded', 'skipped', 'retry_wait',
                    'permanent_failed', 'cancelled'
                  )),
  scheduled_at    TEXT,
  completed_at    TEXT,
  opened_at       TEXT,
  result_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  error_code      TEXT,
  idempotency_key TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  UNIQUE (line_account_id, idempotency_key)
);

CREATE TABLE "booking_reminders" (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES "bookings"(id),
  kind          TEXT NOT NULL CHECK (kind IN ('day_before','hours_before')),
  scheduled_at  TEXT NOT NULL,
  sent_at       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','failed_permanent','cancelled')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);

CREATE TABLE booking_resources (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 1000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE booking_settings (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL UNIQUE REFERENCES line_accounts(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo' CHECK (length(trim(timezone)) > 0),
  booking_window_days INTEGER NOT NULL DEFAULT 60 CHECK (booking_window_days BETWEEN 1 AND 365),
  cutoff_minutes_before INTEGER NOT NULL DEFAULT 1440 CHECK (cutoff_minutes_before BETWEEN 0 AND 43200),
  cancel_deadline_minutes_before INTEGER NOT NULL DEFAULT 1440 CHECK (cancel_deadline_minutes_before BETWEEN 0 AND 43200),
  max_active_bookings_per_friend INTEGER NOT NULL DEFAULT 1 CHECK (max_active_bookings_per_friend BETWEEN 1 AND 100),
  approval_mode TEXT NOT NULL DEFAULT 'automatic' CHECK (approval_mode IN ('automatic', 'manual')),
  hold_minutes INTEGER NOT NULL DEFAULT 15 CHECK (hold_minutes BETWEEN 1 AND 1440),
  slot_granularity_minutes INTEGER NOT NULL DEFAULT 15 CHECK (slot_granularity_minutes IN (5, 10, 15, 30, 60)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE "bookings" (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL,
  friend_id                    TEXT,
  booking_customer_id          TEXT REFERENCES booking_customers(id) ON DELETE RESTRICT,
  staff_id                     TEXT NOT NULL,
  menu_id                      TEXT NOT NULL,
  starts_at                    TEXT NOT NULL,
  ends_at                      TEXT NOT NULL,
  block_ends_at                TEXT NOT NULL,
  status                       TEXT NOT NULL CHECK (status IN ('requested','confirmed','rejected','expired','cancelled','completed','no_show')),
  customer_note                TEXT,
  internal_note                TEXT,
  price_at_booking             INTEGER NOT NULL,
  requested_at                 TEXT NOT NULL,
  decided_at                   TEXT,
  decided_by_staff_id          TEXT,
  external_event_id            TEXT,
  external_calendar_id         TEXT,
  source                       TEXT NOT NULL DEFAULT 'liff'
                                 CHECK (source IN ('liff','phone','counter','operator','import')),
  created_by_staff_id          TEXT,
  updated_by_staff_id          TEXT,
  lock_version                 INTEGER NOT NULL DEFAULT 0,
  notification_policy_snapshot TEXT NOT NULL DEFAULT '{}'
                                 CHECK (json_valid(notification_policy_snapshot)),
  cancelled_at                 TEXT,
  completed_at                 TEXT,
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id),
  FOREIGN KEY (created_by_staff_id) REFERENCES staff(id),
  FOREIGN KEY (updated_by_staff_id) REFERENCES staff(id),
  CHECK (friend_id IS NOT NULL OR booking_customer_id IS NOT NULL)
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

CREATE TABLE broadcast_saved_views (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  filters_json     TEXT NOT NULL DEFAULT '{}'
                   CHECK (json_valid(filters_json)),
  sort_key         TEXT NOT NULL DEFAULT 'newest'
                   CHECK (sort_key IN ('newest', 'oldest', 'title', 'scheduled')),
  page_size        INTEGER NOT NULL DEFAULT 20
                   CHECK (page_size IN (20, 50, 100)),
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (line_account_id, name)
);

CREATE TABLE broadcast_tracked_links (
  broadcast_id     TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  tracked_link_id  TEXT NOT NULL REFERENCES tracked_links(id) ON DELETE RESTRICT,
  label            TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (broadcast_id, tracked_link_id)
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
, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, measure_opens INTEGER NOT NULL DEFAULT 1, internal_memo TEXT, draft_step TEXT
  CHECK (draft_step IS NULL OR draft_step IN ('basic', 'audience', 'message', 'schedule', 'confirm')), draft_payload_json TEXT
  CHECK (draft_payload_json IS NULL OR json_valid(draft_payload_json)), message_options_json TEXT
  CHECK (message_options_json IS NULL OR json_valid(message_options_json)), after_action_version_id TEXT
  REFERENCES common_action_versions(id) ON DELETE RESTRICT, lock_version INTEGER NOT NULL DEFAULT 1
  CHECK (lock_version > 0));

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

CREATE TABLE common_action_binding_migration_events (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id),
  common_action_id         TEXT NOT NULL REFERENCES common_actions(id),
  binding_id               TEXT NOT NULL REFERENCES common_action_bindings(id),
  from_action_version_id   TEXT NOT NULL REFERENCES common_action_versions(id),
  to_action_version_id     TEXT NOT NULL REFERENCES common_action_versions(id),
  actor_id                 TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
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

CREATE TABLE "common_var_replacement_runs" (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_common_var_id  TEXT NOT NULL REFERENCES "common_vars"(id),
  replacement_common_var_id TEXT NOT NULL REFERENCES "common_vars"(id),
  source_version        INTEGER NOT NULL,
  expected_usage_count  INTEGER NOT NULL,
  replaced_usage_count  INTEGER NOT NULL,
  actor_id              TEXT,
  status                TEXT NOT NULL CHECK (status IN ('completed', 'partial')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE "common_var_schedules" (
  id             TEXT PRIMARY KEY,
  var_id         TEXT NOT NULL REFERENCES "common_vars"(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  value          TEXT NOT NULL,
  applied_at     TEXT
);

CREATE TABLE "common_var_versions" (
  id             TEXT PRIMARY KEY,
  common_var_id  TEXT NOT NULL REFERENCES "common_vars"(id) ON DELETE CASCADE,
  version_no     INTEGER NOT NULL,
  name           TEXT NOT NULL,
  value          TEXT NOT NULL,
  memo           TEXT NOT NULL DEFAULT '',
  change_reason  TEXT NOT NULL,
  actor_id       TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  UNIQUE(common_var_id, version_no)
);

CREATE TABLE "common_vars" (
  id                 TEXT PRIMARY KEY,
  folder_id          TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  var_key            TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'text'
                       CHECK (type IN ('text','url','image','number')),
  value              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  line_account_id    TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  memo               TEXT NOT NULL DEFAULT '',
  version            INTEGER NOT NULL DEFAULT 1,
  updated_by         TEXT,
  archived_at        TEXT,
  replacement_run_id TEXT,
  UNIQUE(line_account_id, var_key)
);

CREATE TABLE conversion_definition_operations (
  id                  TEXT PRIMARY KEY,
  conversion_point_id TEXT NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('stop', 'replace', 'delete')),
  replacement_id      TEXT,
  affected_usages     INTEGER NOT NULL DEFAULT 0 CHECK (affected_usages >= 0),
  reason              TEXT,
  performed_by        TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE conversion_definition_usages (
  id                       TEXT PRIMARY KEY,
  conversion_point_id      TEXT NOT NULL REFERENCES conversion_points(id),
  definition_version       INTEGER NOT NULL CHECK (definition_version > 0),
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id),
  ref_kind                 TEXT NOT NULL CHECK (ref_kind IN (
    'affiliate_offer', 'analytics', 'auto_reply', 'scenario', 'nen_campaign',
    'mileage_rule', 'automation', 'ad_platform'
  )),
  ref_id                   TEXT NOT NULL,
  ref_version_id           TEXT,
  created_by               TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

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
  point_name_snapshot  TEXT,
  event_type_snapshot  TEXT,
  value_snapshot       REAL,
  idempotency_key      TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE conversion_points (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  event_type TEXT NOT NULL,
  value      REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  stopped_at TEXT,
  updated_at TEXT
, measure_method TEXT NOT NULL DEFAULT 'manual'
  CHECK (measure_method IN ('url_reach', 'webhook', 'manual')), target_url TEXT, count_repeat INTEGER NOT NULL DEFAULT 1, attribution_days INTEGER, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL, version INTEGER NOT NULL DEFAULT 1
  CHECK (version > 0), source_config_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(source_config_json)), deduplication_mode TEXT NOT NULL DEFAULT 'every'
  CHECK (deduplication_mode IN ('every', 'once_per_friend', 'window')), deduplication_window_days INTEGER
  CHECK (deduplication_window_days IS NULL OR deduplication_window_days BETWEEN 1 AND 365), value_mode TEXT NOT NULL DEFAULT 'fixed'
  CHECK (value_mode IN ('source', 'fixed', 'none')), reversal_policy TEXT NOT NULL DEFAULT 'manual'
  CHECK (reversal_policy IN ('source_cancelled', 'manual', 'none')));

CREATE TABLE customer_notification_definitions (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  key                   TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL,
  source_event_type     TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'stopped')),
  current_version_id    TEXT,
  draft_config_json     TEXT NOT NULL DEFAULT '{}',
  transactional_only    INTEGER NOT NULL DEFAULT 1
                        CHECK (transactional_only = 1),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by            TEXT NOT NULL,
  updated_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (line_account_id, key)
);

CREATE TABLE customer_notification_versions (
  id                      TEXT PRIMARY KEY,
  definition_id           TEXT NOT NULL REFERENCES customer_notification_definitions(id) ON DELETE CASCADE,
  version_number          INTEGER NOT NULL CHECK (version_number > 0),
  config_json             TEXT NOT NULL,
  line_template_json      TEXT NOT NULL,
  aggregation_rule        TEXT NOT NULL DEFAULT 'definition_day',
  email_fallback_policy   TEXT NOT NULL DEFAULT 'disabled',
  published_by            TEXT NOT NULL,
  published_at            TEXT NOT NULL,
  UNIQUE (definition_id, version_number)
);

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

CREATE TABLE ec_action_execution_attempts (
  id TEXT PRIMARY KEY,
  action_execution_id TEXT NOT NULL REFERENCES ec_action_executions(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('automatic', 'manual')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  requested_by TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  error_code TEXT,
  error_message_safe TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (action_execution_id, attempt_number)
);

CREATE TABLE ec_action_executions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES ec_events(id) ON DELETE RESTRICT,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'skipped', 'retryable_failed', 'permanent_failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  error_code TEXT,
  error_message_safe TEXT,
  last_attempted_at TEXT,
  next_retry_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, action_type, rule_version)
);

CREATE TABLE ec_connectors (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('ec_cube', 'shopify')),
  shop_domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'degraded', 'paused', 'auth_expired', 'rate_limited')),
  inbound_secret_encrypted TEXT,
  inbound_secret_last4 TEXT,
  secret_updated_at TEXT,
  event_types_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(event_types_json) AND json_type(event_types_json) = 'array'),
  identity_rules_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(identity_rules_json) AND json_type(identity_rules_json) = 'array'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (line_account_id)
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

CREATE TABLE ec_notification_account_settings (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL REFERENCES ec_notification_settings(event_type) ON DELETE CASCADE,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  title_override TEXT,
  intro_text TEXT,
  outro_text TEXT,
  button_label TEXT,
  button_url TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (line_account_id, event_type)
);

CREATE TABLE ec_notification_settings (
  event_type TEXT PRIMARY KEY,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  title_override TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, intro_text TEXT, outro_text TEXT, category TEXT NOT NULL DEFAULT 'order', button_label TEXT, button_url TEXT, image_url TEXT, display_order INTEGER NOT NULL DEFAULT 100);

CREATE TABLE ec_order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES ec_orders(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  external_product_id TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_amount_minor INTEGER,
  line_amount_minor INTEGER,
  product_url TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (order_id, line_index)
);

CREATE TABLE ec_orders (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  customer_id TEXT,
  friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  normalized_status TEXT NOT NULL DEFAULT 'current'
    CHECK (normalized_status IN ('current', 'refunded', 'cancelled')),
  provider_status TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  total_amount_minor INTEGER,
  refunded_amount_minor INTEGER,
  ordered_at TEXT NOT NULL,
  detail_url TEXT,
  last_event_id TEXT NOT NULL REFERENCES ec_events(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (line_account_id, source_key, external_order_id)
);

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
, pool_id TEXT REFERENCES traffic_pools (id) ON DELETE SET NULL, intro_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL, run_account_friend_add_scenarios INTEGER NOT NULL DEFAULT 1, genre TEXT, tenant_id TEXT REFERENCES tenants(id), line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE);

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
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), identity_key TEXT, party_size INTEGER NOT NULL DEFAULT 1 CHECK (party_size >= 1), answer_snapshot_json TEXT CHECK (
    answer_snapshot_json IS NULL OR json_valid(answer_snapshot_json)
  ), first_participation INTEGER CHECK (first_participation IN (0, 1)), first_participation_attended_count INTEGER CHECK (
    first_participation_attended_count IS NULL OR first_participation_attended_count >= 0
  ), first_participation_checked_at TEXT,
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
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE "event_waitlist" (
  id                             TEXT PRIMARY KEY,
  line_account_id                TEXT NOT NULL,
  event_id                       TEXT NOT NULL,
  slot_id                        TEXT NOT NULL,
  friend_id                      TEXT NOT NULL,
  identity_key                   TEXT NOT NULL,
  status                         TEXT NOT NULL DEFAULT 'waiting'
                                 CHECK (status IN (
                                   'waiting', 'offered', 'accepted',
                                   'converted', 'expired', 'cancelled'
                                 )),
  party_size                     INTEGER NOT NULL DEFAULT 1 CHECK (party_size >= 1),
  answer_snapshot_json           TEXT CHECK (
                                   answer_snapshot_json IS NULL OR json_valid(answer_snapshot_json)
  ),
  first_participation            INTEGER CHECK (first_participation IN (0, 1)),
  first_participation_attended_count INTEGER CHECK (
                                   first_participation_attended_count IS NULL
                                   OR first_participation_attended_count >= 0
                                 ),
  first_participation_checked_at TEXT,
  offered_at                     TEXT,
  offer_expires_at               TEXT,
  offer_token_hash               TEXT UNIQUE,
  notified_at                    TEXT,
  version                        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                     TEXT NOT NULL,
  updated_at                     TEXT NOT NULL,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (slot_id) REFERENCES event_slots(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id)
);

CREATE TABLE event_waitlist_promotion_jobs (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL,
  event_id          TEXT NOT NULL,
  slot_id           TEXT NOT NULL,
  source_key        TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'retryable_failed', 'completed')),
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at      TEXT NOT NULL,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (slot_id) REFERENCES event_slots(id)
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

CREATE TABLE field_migration_items (
  run_id          TEXT NOT NULL REFERENCES field_migration_runs(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  source_value    TEXT NOT NULL,
  converted_value TEXT,
  status          TEXT NOT NULL CHECK (status IN ('convertible', 'review', 'invalid', 'succeeded', 'failed')),
  reason          TEXT,
  migrated_at     TEXT,
  PRIMARY KEY (run_id, friend_id)
);

CREATE TABLE field_migration_runs (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id),
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id),
  source_field_id       TEXT NOT NULL REFERENCES friend_fields(id),
  target_field_id       TEXT NOT NULL REFERENCES friend_fields(id),
  source_version        INTEGER NOT NULL,
  target_version        INTEGER NOT NULL,
  preview_token_hash    TEXT NOT NULL UNIQUE,
  preview_snapshot_hash TEXT NOT NULL,
  preview_expires_at    TEXT NOT NULL,
  idempotency_key       TEXT,
  status                TEXT NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed', 'queued', 'running', 'partial', 'succeeded', 'failed', 'stale')),
  usage_targets_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(usage_targets_json)),
  total_count           INTEGER NOT NULL DEFAULT 0,
  convertible_count     INTEGER NOT NULL DEFAULT 0,
  review_count          INTEGER NOT NULL DEFAULT 0,
  invalid_count         INTEGER NOT NULL DEFAULT 0,
  processed_count       INTEGER NOT NULL DEFAULT 0,
  succeeded_count       INTEGER NOT NULL DEFAULT 0,
  failed_count          INTEGER NOT NULL DEFAULT 0,
  error_message         TEXT,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  started_at            TEXT,
  completed_at          TEXT,
  rollback_deadline     TEXT,
  updated_at            TEXT NOT NULL
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
, account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE);

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
, destination_write_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (destination_write_status IN ('pending', 'succeeded', 'partial', 'failed', 'not_requested', 'unknown')), destination_write_attempted INTEGER, destination_write_succeeded INTEGER, destination_write_failed INTEGER, destination_write_completed_at TEXT);

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
, on_submit_message_type TEXT CHECK (on_submit_message_type IN ('text', 'flex')) DEFAULT NULL, on_submit_message_content TEXT DEFAULT NULL, on_submit_webhook_url TEXT, on_submit_webhook_headers TEXT, on_submit_webhook_fail_message TEXT, og_title TEXT, og_description TEXT, og_image_url TEXT, layout TEXT, status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived')), archived_at TEXT, revision INTEGER NOT NULL DEFAULT 1
  CHECK (revision >= 1));

CREATE TABLE friend_add_action_runs (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT NOT NULL REFERENCES friend_add_events(id) ON DELETE CASCADE,
  action_stable_id    TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempt_count       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at       TEXT,
  last_error_code     TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (event_id, action_stable_id)
);

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
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), winning_rule_version_id TEXT, error_code TEXT, scenario_enrollment_id TEXT REFERENCES friend_scenarios(id) ON DELETE SET NULL, delivery_count INTEGER NOT NULL DEFAULT 0
  CHECK (delivery_count >= 0), first_delivery_sent_at TEXT,
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

CREATE TABLE friend_add_rule_folders (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  create_idempotency_key  TEXT NOT NULL,
  created_by_staff_id     TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE (line_account_id, name),
  UNIQUE (line_account_id, create_idempotency_key)
);

CREATE TABLE friend_add_rule_versions (
  id                       TEXT PRIMARY KEY,
  rule_id                  TEXT NOT NULL REFERENCES friend_add_rules(id) ON DELETE CASCADE,
  version_number           INTEGER NOT NULL,
  definition_snapshot      TEXT NOT NULL CHECK (json_valid(definition_snapshot)),
  status                   TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  last_test_status         TEXT CHECK (last_test_status IN ('succeeded', 'failed')),
  last_tested_at           TEXT,
  last_tested_by_staff_id  TEXT,
  draft_save_idempotency_key TEXT,
  published_at             TEXT,
  published_by_staff_id    TEXT,
  publish_idempotency_key  TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (rule_id, version_number),
  UNIQUE (rule_id, draft_save_idempotency_key),
  UNIQUE (rule_id, publish_idempotency_key)
);

CREATE TABLE friend_add_rules (
  id                         TEXT PRIMARY KEY,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_kind                TEXT NOT NULL CHECK (friend_kind IN ('first_time', 'returning')),
  name                       TEXT NOT NULL,
  folder_name                TEXT,
  priority                   INTEGER NOT NULL CHECK (priority > 0),
  is_unknown_route_fallback  INTEGER NOT NULL DEFAULT 0
                               CHECK (is_unknown_route_fallback IN (0, 1)),
  status                     TEXT NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'published', 'stopped', 'archived')),
  current_version_id         TEXT,
  create_idempotency_key     TEXT,
  archived_at                TEXT,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, lock_version INTEGER NOT NULL DEFAULT 1
  CHECK (lock_version > 0), stop_idempotency_key TEXT, stopped_at TEXT, stopped_by_staff_id TEXT, created_from_recipe_id TEXT REFERENCES recipes(id), recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id));

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

CREATE TABLE friend_export_jobs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  filter_json TEXT NOT NULL CHECK (json_valid(filter_json)),
  columns_json TEXT NOT NULL CHECK (json_valid(columns_json)),
  encoding TEXT NOT NULL CHECK (encoding IN ('utf-8','shift_jis')),
  status TEXT NOT NULL CHECK (status IN ('completed','failed','expired')),
  row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  failure_reason TEXT
);

CREATE TABLE friend_field_reminder_scan_states (
  reminder_id TEXT PRIMARY KEY REFERENCES reminders(id) ON DELETE CASCADE,
  cursor      TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
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
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')), value_text TEXT, value_number REAL, value_date TEXT, value_datetime TEXT, value_json TEXT
  CHECK (value_json IS NULL OR json_valid(value_json)), media_id TEXT REFERENCES media(id) ON DELETE SET NULL, source_type TEXT, source_id TEXT, version INTEGER NOT NULL DEFAULT 1,
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
, status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'read_only', 'archived')), version INTEGER NOT NULL DEFAULT 1, type_v6 TEXT
  CHECK (type_v6 IS NULL OR type_v6 IN (
    'text','textarea','number','date','datetime','tel','email','url',
    'select','multi_select','checkbox','image','pdf'
  )));

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

CREATE TABLE friend_import_jobs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  source_filename TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  rows_json TEXT NOT NULL CHECK (json_valid(rows_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  status TEXT NOT NULL CHECK (status IN ('previewed','completed','failed')),
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  add_count INTEGER NOT NULL DEFAULT 0 CHECK (add_count >= 0),
  update_count INTEGER NOT NULL DEFAULT 0 CHECK (update_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  executed_at TEXT,
  failure_reason TEXT,
  UNIQUE(line_account_id, source_checksum)
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
, reminder_version_id TEXT REFERENCES reminder_versions(id), source_kind TEXT NOT NULL DEFAULT 'manual', source_id TEXT, source_event_id TEXT, timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo', cancel_reason TEXT, completed_at TEXT, lock_version INTEGER NOT NULL DEFAULT 0);

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
, line_account_id TEXT REFERENCES line_accounts(id), event_type TEXT, source TEXT, source_event_id TEXT, subject_key TEXT, frequency_key TEXT, rule_key TEXT, rule_version_id TEXT REFERENCES action_score_rule_versions(id), idempotency_key TEXT, operation TEXT
  CHECK (operation IS NULL OR operation IN ('delta', 'set', 'manual_adjustment')), score_before INTEGER, score_after INTEGER, occurred_at TEXT, executed_by_staff_id TEXT, executed_by_staff_name TEXT);

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
, version INTEGER NOT NULL DEFAULT 1
  CHECK (version > 0), identity_match_json TEXT NOT NULL DEFAULT
  '{"methods":[],"onNotFound":"do_nothing"}', action_refs_json TEXT NOT NULL DEFAULT '[]', latest_masked_sample_json TEXT, latest_received_at TEXT);

CREATE TABLE line_account_connection_checks (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  check_kind        TEXT NOT NULL CHECK (check_kind IN (
    'bot_info', 'webhook_endpoint', 'webhook_test', 'liff_config', 'token_refresh'
  )),
  result            TEXT NOT NULL CHECK (result IN (
    'matched', 'mismatched', 'unconfigured', 'unknown', 'ok', 'failed'
  )),
  expected_url      TEXT,
  registered_url    TEXT,
  webhook_active    INTEGER CHECK (webhook_active IN (0, 1) OR webhook_active IS NULL),
  http_status       INTEGER,
  checked_by        TEXT NOT NULL,
  checked_at        TEXT NOT NULL,
  correlation_id    TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  account_revision  INTEGER NOT NULL,
  UNIQUE (line_account_id, idempotency_key, check_kind)
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
  channel_access_token_updated_at TEXT,
  channel_secret_updated_at       TEXT,
  login_channel_secret_updated_at TEXT,
  is_active              INTEGER NOT NULL DEFAULT 1,
  is_default             INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  archived_at            TEXT,
  archived_by            TEXT,
  archived_reason        TEXT,
  country                TEXT,
  role                   TEXT,
  display_order          INTEGER NOT NULL DEFAULT 0,
  og_site_name           TEXT,
  og_default_image_url   TEXT,
  og_default_description TEXT,
  official_profile_url   TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, login_channel_id TEXT, login_channel_secret TEXT, liff_id TEXT, token_expires_at TEXT, friend_capacity INTEGER, capacity_warn_at INTEGER, icon_url TEXT, parent_line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL, tenant_id TEXT REFERENCES tenants(id), timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo', provider_id TEXT, revision INTEGER NOT NULL DEFAULT 1);

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

CREATE TABLE manual_link_check_history (
  id          TEXT PRIMARY KEY,
  link_key    TEXT NOT NULL REFERENCES manual_links(key) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('ok', 'broken')),
  http_status INTEGER,
  error_code  TEXT,
  checked_by  TEXT,
  checked_at  TEXT NOT NULL
);

CREATE TABLE manual_links (
  -- 画面ID（`2-1` など）か、作業ID（`createOfficialAccount` など）。
  -- 要件 §8-2「正本表に『作業 ID』の列を足して吸収する」。
  key           TEXT PRIMARY KEY,
  /*
    どちらの ID か。
      screen … 画面ID。トップバーの「マニュアル」が引く
      task   … 作業ID。はじめの設定や店舗登録の案内リンクが引く
  */
  key_kind      TEXT NOT NULL CHECK (key_kind IN ('screen', 'task')),
  name          TEXT NOT NULL,
  -- 公式記事の URL。まだ決めていなければ null。**空文字を入れない。**
  url           TEXT,
  /*
    リンクの状態。
      ok     … 開ける（確かめた）
      broken … 開けない
      unset  … まだ決めていない
    **確かめていない URL を ok にしない。** 確かめて初めて言える。
  */
  status        TEXT NOT NULL DEFAULT 'unset' CHECK (status IN ('ok', 'broken', 'unset')),
  last_checked_at TEXT,
  -- 開けなかったときの手がかり（HTTP の状態など）。
  last_error    TEXT,
  updated_by    TEXT,
  updated_at    TEXT NOT NULL
, version INTEGER NOT NULL DEFAULT 1
  CHECK (version > 0), last_http_status INTEGER);

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

CREATE TABLE media_storage_quotas (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  limit_bytes     INTEGER NOT NULL DEFAULT 10737418240 CHECK (limit_bytes > 0),
  updated_by      TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE media_upload_sessions (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  target_media_id   TEXT REFERENCES media(id) ON DELETE CASCADE,
  result_media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  folder_id         TEXT REFERENCES folders(id) ON DELETE SET NULL,
  filename          TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
  expected_mime     TEXT NOT NULL,
  expected_size     INTEGER NOT NULL CHECK (expected_size > 0),
  r2_key            TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','verified','completed','failed','expired')),
  failure_code      TEXT,
  etag              TEXT,
  expires_at        TEXT NOT NULL,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  completed_at      TEXT
);

CREATE TABLE media_usage_scan_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  source_index     INTEGER NOT NULL DEFAULT 0,
  last_ref_id      TEXT NOT NULL DEFAULT '',
  cycle_started_at TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE media_usages (
  media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  ref_kind   TEXT NOT NULL CHECK (ref_kind IN (
               'template','broadcast','rich_menu','scenario_step',
               'nen_column','event','webinar')),
  ref_id     TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (media_id, ref_kind, ref_id)
);

CREATE TABLE media_versions (
  id             TEXT PRIMARY KEY,
  media_id       TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  version_no     INTEGER NOT NULL CHECK (version_no > 0),
  r2_key         TEXT NOT NULL UNIQUE,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes >= 0),
  width          INTEGER,
  height         INTEGER,
  duration_ms    INTEGER,
  page_count     INTEGER,
  codec          TEXT,
  content_hash   TEXT,
  etag           TEXT,
  scan_status    TEXT NOT NULL DEFAULT 'verified'
                     CHECK (scan_status IN ('pending','verified','failed','quarantined')),
  scan_result    TEXT,
  scanned_at     TEXT,
  change_reason  TEXT,
  uploaded_by    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  published_at   TEXT,
  UNIQUE (media_id, version_no)
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
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), concurrent_capacity INTEGER NOT NULL DEFAULT 1, booking_window_days INTEGER, cutoff_hours_before INTEGER, cancel_deadline_hours_before INTEGER, intake_question TEXT, price_mode TEXT NOT NULL DEFAULT 'fixed'
  CHECK (price_mode IN ('fixed', 'free', 'inquiry') AND (price_mode = 'fixed' OR base_price = 0)), version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
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

CREATE TABLE mileage_adjustment_notifications (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id),
  friend_id         TEXT NOT NULL REFERENCES friends(id),
  ledger_entry_id   TEXT NOT NULL UNIQUE REFERENCES mileage_ledger(id),
  idempotency_key   TEXT NOT NULL,
  message_text      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count     INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  line_request_id   TEXT,
  error_code        TEXT,
  first_failed_at   TEXT,
  sent_at           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (line_account_id, idempotency_key)
);

CREATE TABLE mileage_earning_rule_drafts (
  rule_id             TEXT PRIMARY KEY REFERENCES mileage_rules(id),
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id),
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  draft_json          TEXT NOT NULL CHECK (json_valid(draft_json)),
  updated_by_staff_id TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE mileage_grant_lots (
  ledger_entry_id       TEXT PRIMARY KEY REFERENCES mileage_ledger(id),
  program_id            TEXT NOT NULL REFERENCES mileage_programs(id),
  beneficiary_key       TEXT NOT NULL,
  original_amount       INTEGER NOT NULL CHECK (original_amount > 0),
  remaining_amount      INTEGER NOT NULL CHECK (remaining_amount >= 0),
  available_at          TEXT NOT NULL,
  expires_at            TEXT,
  status                TEXT NOT NULL DEFAULT 'available'
                          CHECK (status IN ('available', 'exhausted', 'expired', 'void')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
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

CREATE TABLE mileage_redemption_attempts (
  id              TEXT PRIMARY KEY,
  redemption_id   TEXT NOT NULL REFERENCES mileage_redemptions(id),
  attempt_number  INTEGER NOT NULL CHECK (attempt_number > 0),
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'succeeded', 'failed')),
  error_code      TEXT,
  error_message   TEXT,
  started_at      TEXT NOT NULL,
  completed_at    TEXT,
  UNIQUE (redemption_id, attempt_number)
);

CREATE TABLE mileage_redemptions (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id),
  program_id               TEXT NOT NULL REFERENCES mileage_programs(id),
  beneficiary_key          TEXT NOT NULL,
  beneficiary_user_id      TEXT REFERENCES users(id),
  beneficiary_friend_id    TEXT REFERENCES friends(id),
  reward_id                TEXT NOT NULL REFERENCES mileage_rewards(id),
  reward_version_id        TEXT NOT NULL REFERENCES mileage_reward_versions(id),
  spend_ledger_entry_id    TEXT REFERENCES mileage_ledger(id),
  reward_code_id           TEXT,
  idempotency_key          TEXT NOT NULL,
  request_fingerprint      TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'reserved'
                             CHECK (status IN (
                               'reserved', 'delivering', 'succeeded',
                               'delivery_failed', 'refunded'
                             )),
  attempt_count            INTEGER NOT NULL DEFAULT 0,
  next_retry_at            TEXT,
  failure_code             TEXT,
  failure_message          TEXT,
  delivered_at             TEXT,
  refunded_at              TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program_id, idempotency_key)
);

CREATE TABLE mileage_reward_codes (
  id                 TEXT PRIMARY KEY,
  reward_version_id  TEXT NOT NULL REFERENCES mileage_reward_versions(id),
  code_ciphertext    TEXT NOT NULL,
  code_fingerprint   TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'available'
                       CHECK (status IN ('available', 'reserved', 'issued', 'void')),
  redemption_id      TEXT UNIQUE REFERENCES mileage_redemptions(id),
  reserved_at        TEXT,
  issued_at          TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reward_version_id, code_fingerprint)
);

CREATE TABLE mileage_reward_versions (
  id                       TEXT PRIMARY KEY,
  reward_id                TEXT NOT NULL REFERENCES mileage_rewards(id),
  version_number           INTEGER NOT NULL CHECK (version_number > 0),
  status                   TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'published')),
  required_miles           INTEGER NOT NULL CHECK (required_miles > 0),
  stock_limit              INTEGER CHECK (stock_limit IS NULL OR stock_limit >= 0),
  per_friend_limit         INTEGER CHECK (per_friend_limit IS NULL OR per_friend_limit > 0),
  starts_at                TEXT,
  ends_at                  TEXT,
  benefit_expires_days     INTEGER CHECK (benefit_expires_days IS NULL OR benefit_expires_days > 0),
  common_action_version_id TEXT REFERENCES common_action_versions(id),
  failure_policy           TEXT NOT NULL DEFAULT 'retry'
                             CHECK (failure_policy IN ('retry', 'refund', 'manual')),
  customer_message         TEXT NOT NULL DEFAULT '',
  created_by               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  published_at             TEXT, target_conditions TEXT,
  UNIQUE (reward_id, version_number)
);

CREATE TABLE mileage_rewards (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL REFERENCES line_accounts(id),
  program_id                   TEXT NOT NULL DEFAULT 'default' REFERENCES mileage_programs(id),
  name                         TEXT NOT NULL,
  description                  TEXT,
  image_url                    TEXT,
  reward_kind                  TEXT NOT NULL
                                 CHECK (reward_kind IN (
                                   'coupon', 'tag', 'scenario', 'template',
                                   'early_access', 'rank'
                                 )),
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'stopped', 'archived')),
  sort_order                   INTEGER NOT NULL DEFAULT 0,
  current_draft_version_id     TEXT REFERENCES mileage_reward_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES mileage_reward_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at                  TEXT
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
  line_account_id TEXT REFERENCES line_accounts(id),
  is_active      INTEGER NOT NULL DEFAULT 1,
  valid_from     TEXT,
  valid_until    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE mileage_spend_allocations (
  id                TEXT PRIMARY KEY,
  redemption_id     TEXT NOT NULL REFERENCES mileage_redemptions(id),
  spend_ledger_id   TEXT NOT NULL REFERENCES mileage_ledger(id),
  grant_lot_id      TEXT NOT NULL REFERENCES mileage_grant_lots(ledger_entry_id),
  amount            INTEGER NOT NULL CHECK (amount > 0),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (redemption_id, grant_lot_id)
);

CREATE TABLE mileage_wallets (
  program_id            TEXT NOT NULL REFERENCES mileage_programs(id),
  beneficiary_key       TEXT NOT NULL,
  beneficiary_user_id   TEXT REFERENCES users(id),
  beneficiary_friend_id TEXT REFERENCES friends(id),
  available             INTEGER NOT NULL DEFAULT 0,
  pending               INTEGER NOT NULL DEFAULT 0,
  version               INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (program_id, beneficiary_key)
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

CREATE TABLE nen_column_read_events (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES nen_columns(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('opened', 'completed')),
  idempotency_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (line_account_id, idempotency_key)
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
, intro_text TEXT, target_mode TEXT NOT NULL DEFAULT 'all'
  CHECK (target_mode IN ('all', 'tag')), target_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL, completion_event_name TEXT, completion_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL, source_column_id TEXT REFERENCES nen_columns(id) ON DELETE SET NULL);

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
), version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1), retry_generation INTEGER NOT NULL DEFAULT 0 CHECK (retry_generation >= 0), last_retry_reason TEXT CHECK (
    last_retry_reason IS NULL OR length(last_retry_reason) BETWEEN 1 AND 500
  ), last_retry_requested_by TEXT, last_retry_requested_at TEXT,
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

CREATE TABLE "nen_friend_add_coupon_issues" (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  coupon_code     TEXT NOT NULL,
  discount_rate   INTEGER NOT NULL CHECK (discount_rate BETWEEN 1 AND 100),
  valid_from      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'coupon_created', 'sent', 'failed_create', 'failed_send')),
  last_error      TEXT,
  issued_at       TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (line_account_id, friend_id)
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

CREATE TABLE nen_photo_assessment_runs (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  requested_version INTEGER NOT NULL CHECK (requested_version > 0),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  provider TEXT,
  model_version TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(line_account_id, requested_by, idempotency_key)
);

CREATE TABLE nen_photo_asset_jobs (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  operation TEXT NOT NULL CHECK (operation IN ('review', 'public', 'thumbnail', 'all')),
  requested_version INTEGER NOT NULL CHECK (requested_version > 0),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(line_account_id, requested_by, idempotency_key)
);

CREATE TABLE nen_photo_bulk_decision_receipts (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  UNIQUE(line_account_id, requested_by, idempotency_key)
);

CREATE TABLE nen_photo_derivatives (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('review', 'public', 'thumbnail')),
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  created_at TEXT NOT NULL,
  UNIQUE(photo_id, kind, source_version)
);

CREATE TABLE nen_photo_original_download_audit (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  requested_by TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('issued', 'downloaded')),
  created_at TEXT NOT NULL
);

CREATE TABLE nen_photo_original_download_grants (
  token_hash TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  requested_by TEXT NOT NULL,
  requested_version INTEGER NOT NULL CHECK (requested_version > 0),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(line_account_id, requested_by, idempotency_key)
);

CREATE TABLE nen_photo_publication_placements (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES nen_photo_publications(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  placement_type TEXT NOT NULL CHECK (placement_type IN ('rich_menu', 'column', 'form', 'site')),
  placement_label TEXT NOT NULL,
  view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE(publication_id, placement_type, placement_label)
);

CREATE TABLE nen_photo_publications (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL UNIQUE REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'withdrawn')),
  show_owner_name INTEGER NOT NULL DEFAULT 0 CHECK (show_owner_name IN (0, 1)),
  view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_idempotency_key TEXT,
  published_at TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawn_by TEXT,
  updated_at TEXT NOT NULL
);

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

CREATE TABLE nen_photo_reward_outbox (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL UNIQUE REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  provider_award_key TEXT NOT NULL UNIQUE,
  policy_version TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_attempt_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE nen_photo_risk_assessments (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  flag TEXT NOT NULL,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  note TEXT,
  provider TEXT,
  model_version TEXT,
  assessed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
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
  CHECK (review_notification_status IN ('not_required', 'pending', 'sent', 'failed')), review_image_url TEXT, public_image_url TEXT, image_width INTEGER CHECK (image_width IS NULL OR image_width > 0), image_height INTEGER CHECK (image_height IS NULL OR image_height > 0), image_byte_size INTEGER CHECK (image_byte_size IS NULL OR image_byte_size >= 0), captured_device TEXT, review_version INTEGER NOT NULL DEFAULT 1 CHECK (review_version > 0));

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

CREATE TABLE nen_tag_refresh_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  last_friend_id   TEXT NOT NULL DEFAULT '',
  cycle_started_at TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE notification_aggregate_metrics (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  definition_id         TEXT NOT NULL REFERENCES customer_notification_definitions(id) ON DELETE CASCADE,
  metric_date           TEXT NOT NULL,
  aggregation_unit      TEXT NOT NULL,
  accepted_count        INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  display_count         INTEGER CHECK (display_count IS NULL OR display_count >= 0),
  click_count           INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  state                 TEXT NOT NULL CHECK (state IN ('waiting', 'ready', 'unavailable_privacy', 'failed')),
  reason                TEXT,
  updated_at            TEXT NOT NULL,
  UNIQUE (line_account_id, definition_id, metric_date, aggregation_unit)
);

CREATE TABLE notification_deliveries (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  instance_id             TEXT NOT NULL REFERENCES notification_instances(id) ON DELETE CASCADE,
  audience_type           TEXT NOT NULL CHECK (audience_type IN ('customer', 'operator')),
  recipient_type          TEXT NOT NULL CHECK (recipient_type IN ('friend', 'staff', 'team', 'role')),
  recipient_id            TEXT NOT NULL,
  channel                 TEXT NOT NULL CHECK (channel IN ('line', 'email', 'in_app')),
  idempotency_key         TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'provider_accepted', 'excluded', 'retry_wait', 'failed')),
  retryable               INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  attempts                INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at           TEXT,
  provider_request_id     TEXT,
  provider_status         TEXT,
  error_code              TEXT,
  error_message_safe      TEXT,
  queued_at               TEXT NOT NULL,
  accepted_at             TEXT,
  failed_at               TEXT,
  execution_mode          TEXT NOT NULL DEFAULT 'automatic'
                          CHECK (execution_mode IN ('automatic', 'retry', 'resend', 'test')),
  version                 INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at              TEXT NOT NULL,
  UNIQUE (line_account_id, idempotency_key)
);

CREATE TABLE notification_delivery_attempts (
  id                    TEXT PRIMARY KEY,
  delivery_id           TEXT NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  attempt_number        INTEGER NOT NULL CHECK (attempt_number > 0),
  retry_key             TEXT NOT NULL,
  outcome               TEXT NOT NULL CHECK (outcome IN ('provider_accepted', 'retry_wait', 'failed')),
  provider_request_id   TEXT,
  error_code            TEXT,
  error_message_safe    TEXT,
  attempted_at          TEXT NOT NULL,
  UNIQUE (delivery_id, attempt_number)
);

CREATE TABLE notification_instances (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  audience_type           TEXT NOT NULL CHECK (audience_type IN ('customer', 'operator')),
  definition_id           TEXT,
  definition_version_id   TEXT,
  source_event_type       TEXT NOT NULL,
  source_event_id         TEXT NOT NULL,
  source_metadata_json    TEXT,
  dedupe_key              TEXT NOT NULL,
  occurrence_count        INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  grouped_count           INTEGER NOT NULL DEFAULT 1 CHECK (grouped_count > 0),
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed', 'excluded', 'failed')),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE (line_account_id, dedupe_key)
);

CREATE TABLE notification_interactions (
  id            TEXT PRIMARY KEY,
  delivery_id   TEXT NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  link_key      TEXT NOT NULL,
  clicked_at    TEXT NOT NULL,
  UNIQUE (delivery_id, link_key, clicked_at)
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

CREATE TABLE operation_control_sets (
  scope_key          TEXT PRIMARY KEY,
  line_account_id    TEXT REFERENCES line_accounts(id),
  version            INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  states_json        TEXT NOT NULL CHECK (json_valid(states_json)),
  active_incident_id TEXT,
  reason             TEXT,
  actor_id            TEXT,
  stopped_at         TEXT,
  updated_at         TEXT NOT NULL
);

CREATE TABLE operation_deployment_events (
  id                 TEXT PRIMARY KEY,
  deployment_id      TEXT NOT NULL,
  phase              TEXT NOT NULL CHECK (phase IN (
    'queued', 'deploying', 'verifying', 'succeeded', 'failed', 'rolled_back'
  )),
  environment        TEXT NOT NULL,
  from_commit        TEXT,
  to_commit          TEXT,
  version            TEXT,
  migration_json     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(migration_json)),
  rollback_available INTEGER NOT NULL DEFAULT 0 CHECK (rollback_available IN (0, 1)),
  downtime_seconds   INTEGER CHECK (downtime_seconds IS NULL OR downtime_seconds >= 0),
  pull_request       INTEGER,
  release_summary    TEXT,
  actor              TEXT NOT NULL,
  smoke_check_json   TEXT CHECK (smoke_check_json IS NULL OR json_valid(smoke_check_json)),
  occurred_at        TEXT NOT NULL,
  received_at        TEXT NOT NULL,
  UNIQUE (deployment_id, phase)
);

CREATE TABLE operation_health_results (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES operation_health_runs(id) ON DELETE CASCADE,
  check_key      TEXT NOT NULL CHECK (check_key IN (
    'line_connection', 'message_quota', 'external_integrations',
    'webhook', 'dispatch_jobs', 'friend_change'
  )),
  status         TEXT NOT NULL CHECK (status IN ('normal', 'warning', 'danger', 'unknown')),
  summary        TEXT NOT NULL,
  value_json     TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  threshold_json TEXT CHECK (threshold_json IS NULL OR json_valid(threshold_json)),
  source         TEXT NOT NULL,
  observed_at    TEXT NOT NULL,
  UNIQUE (run_id, check_key)
);

CREATE TABLE operation_health_runs (
  id                TEXT PRIMARY KEY,
  scope_key         TEXT NOT NULL,
  line_account_id   TEXT REFERENCES line_accounts(id),
  window_started_at TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('scheduled', 'manual')),
  status            TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  overall_status    TEXT NOT NULL CHECK (overall_status IN ('normal', 'warning', 'danger', 'unknown')),
  actor_id          TEXT,
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  error_message     TEXT,
  UNIQUE (scope_key, window_started_at)
);

CREATE TABLE operation_incidents (
  id                    TEXT PRIMARY KEY,
  scope_key             TEXT NOT NULL,
  line_account_id       TEXT REFERENCES line_accounts(id),
  status                TEXT NOT NULL CHECK (status IN ('preparing', 'stopped', 'resolved', 'failed')),
  capabilities_json     TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  reason                TEXT NOT NULL,
  detail                TEXT,
  actor_id               TEXT NOT NULL,
  resolved_by_actor_id  TEXT,
  control_version       INTEGER,
  before_snapshot_json  TEXT NOT NULL CHECK (json_valid(before_snapshot_json)),
  stopped_snapshot_json TEXT CHECK (stopped_snapshot_json IS NULL OR json_valid(stopped_snapshot_json)),
  restored_snapshot_json TEXT CHECK (restored_snapshot_json IS NULL OR json_valid(restored_snapshot_json)),
  error_message         TEXT,
  stopped_at            TEXT,
  resolved_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE operation_notification_outbox (
  id              TEXT PRIMARY KEY,
  incident_id     TEXT NOT NULL REFERENCES operation_incidents(id),
  event_kind      TEXT NOT NULL CHECK (event_kind IN ('stopped', 'restored')),
  channel         TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),
  attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error      TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (incident_id, event_kind, channel)
);

CREATE TABLE operation_request_receipts (
  action          TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (action, actor_id, idempotency_key)
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

CREATE TABLE "recipe_clone_items" (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES "recipe_clone_runs"(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE "recipe_clone_runs" (
  id                  TEXT PRIMARY KEY,
  recipe_id           TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  recipe_version      INTEGER NOT NULL,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name_prefix         TEXT,
  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'succeeded', 'failed', 'rolled_back')),
  idempotency_key     TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_count       INTEGER NOT NULL DEFAULT 0,
  failure_reason      TEXT,
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  finished_at         TEXT,
  UNIQUE (line_account_id, idempotency_key)
);

CREATE TABLE recipes (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  -- 作られるものの1行。設計 34-2 の「作られるもの：」に出す。
  creates_summary TEXT NOT NULL,
  -- 版。**複製したあとに新版を出しても、作られた定義は変わらない**（§7-4）。
  version        INTEGER NOT NULL DEFAULT 1,
  -- 初期同梱か、組織が作ったものか。
  origin         TEXT NOT NULL DEFAULT 'builtin' CHECK (origin IN ('builtin', 'org')),
  -- 必要な機能。機能設定の鍵の配列。切れない機能は入れない。
  required_features TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_features)),
  /*
    作られるものの内訳。**決まっていないものを埋めない。**
    決まっていなければ null にして、画面で「まだ決まっていません」と言う。
  */
  items_json     TEXT CHECK (items_json IS NULL OR json_valid(items_json)),
  -- 全部でいくつ作られるか。内訳が決まっていなくても数だけは分かる。
  item_count     INTEGER,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE ref_tracking (
  id              TEXT PRIMARY KEY,
  ref_code        TEXT NOT NULL,
  friend_id       TEXT REFERENCES friends (id) ON DELETE CASCADE,
  entry_route_id  TEXT REFERENCES entry_routes (id) ON DELETE SET NULL,
  source_url      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
, fbclid TEXT, gclid TEXT, twclid TEXT, ttclid TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, user_agent TEXT, ip_address TEXT);

CREATE TABLE reminder_delivery_runs (
  id                         TEXT PRIMARY KEY,
  -- 古いリマインダにはアカウントが未設定の行がある。送信を止めずに履歴化し、
  -- 画面の到達可否は親 reminder の権限で判定するため、移行中だけNULLを許す。
  line_account_id            TEXT,
  reminder_id                TEXT NOT NULL,
  friend_reminder_id         TEXT NOT NULL,
  friend_id                  TEXT NOT NULL,
  reminder_step_id           TEXT NOT NULL,
  scheduled_at               TEXT NOT NULL,
  idempotency_key            TEXT NOT NULL UNIQUE,
  line_retry_key             TEXT NOT NULL UNIQUE,
  status                     TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'claimed', 'succeeded', 'skipped',
      'retry_wait', 'permanent_failed', 'cancelled'
    )),
  attempt_count              INTEGER NOT NULL DEFAULT 0,
  retry_cycle_attempt_count  INTEGER NOT NULL DEFAULT 0,
  next_retry_at              TEXT,
  lease_expires_at           TEXT,
  last_error_code            TEXT,
  last_error_message         TEXT,
  line_request_id            TEXT,
  -- 実際に送った本文はmessages_logを正本にし、この実行から1本で辿れるようにする。
  message_log_id             TEXT,
  manual_retry_key           TEXT UNIQUE,
  started_at                 TEXT,
  completed_at               TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  UNIQUE (friend_reminder_id, reminder_step_id, scheduled_at)
);

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

CREATE TABLE reminder_version_steps (
  id TEXT PRIMARY KEY,
  reminder_version_id TEXT NOT NULL REFERENCES reminder_versions(id) ON DELETE CASCADE,
  stable_step_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  offset_minutes INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  message_content TEXT NOT NULL,
  offset_days INTEGER,
  send_at_time TEXT,
  template_id TEXT,
  target_condition_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(target_condition_json)),
  action_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(action_json)),
  created_at TEXT NOT NULL,
  UNIQUE (reminder_version_id, stable_step_id)
);

CREATE TABLE reminder_versions (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'superseded')),
  settings_snapshot TEXT NOT NULL CHECK (json_valid(settings_snapshot)),
  last_test_status TEXT CHECK (last_test_status IN ('succeeded', 'failed')),
  last_tested_at TEXT,
  last_tested_by_staff_id TEXT,
  published_at TEXT,
  published_by_staff_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (reminder_id, version_number)
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
, display_order INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, lifecycle_status TEXT NOT NULL DEFAULT 'published'
  CHECK (lifecycle_status IN ('draft', 'published', 'stopped')), current_draft_version_id TEXT, current_published_version_id TEXT, created_from_recipe_id TEXT REFERENCES recipes(id), recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id));

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

CREATE TABLE rich_menu_assignment_runs (
  id                     TEXT PRIMARY KEY,
  version_id             TEXT,
  friend_id              TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id        TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  group_id               TEXT REFERENCES rich_menu_groups(id) ON DELETE SET NULL,
  source_event_id        TEXT,
  idempotency_key        TEXT NOT NULL,
  previous_assignment_id TEXT,
  operation              TEXT NOT NULL CHECK (operation IN ('link', 'unlink')),
  status                 TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  attempt_count          INTEGER NOT NULL DEFAULT 1,
  next_retry_at          TEXT,
  last_error_code        TEXT,
  started_at             TEXT NOT NULL,
  completed_at           TEXT,
  UNIQUE (line_account_id, idempotency_key)
);

CREATE TABLE rich_menu_assignments (
  id                 TEXT PRIMARY KEY,
  friend_id          TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  group_id           TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  version_id         TEXT,
  line_richmenu_id   TEXT NOT NULL,
  reason_kind        TEXT NOT NULL,
  reason_event_id    TEXT,
  assigned_at        TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (line_account_id, friend_id)
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
, publishing_owner TEXT, publishing_expires_at TEXT, publishing_generation INTEGER NOT NULL DEFAULT 0);

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

CREATE TABLE rich_menu_schedule_publications (
  schedule_id      TEXT NOT NULL REFERENCES rich_menu_schedules(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL DEFAULT 'publish' CHECK (kind IN ('publish', 'restore')),
  page_id          TEXT NOT NULL,
  line_richmenu_id TEXT NOT NULL,
  run_id           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (schedule_id, kind, page_id)
);

CREATE TABLE rich_menu_schedules (
  id                    TEXT PRIMARY KEY,
  group_id              TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  mode                  TEXT NOT NULL CHECK (mode IN ('scheduled', 'period')),
  starts_at             TEXT NOT NULL,
  ends_at               TEXT,
  restore_group_id      TEXT REFERENCES rich_menu_groups(id) ON DELETE SET NULL,
  definition_snapshot   TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'publishing', 'published', 'restoring', 'completed', 'cancelled', 'failed')),
  idempotency_key       TEXT NOT NULL,
  requested_by_staff_id TEXT NOT NULL,
  started_run_id        TEXT,
  ended_run_id          TEXT,
  last_error_code       TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), next_retry_at TEXT, lease_expires_at TEXT, restore_default_state TEXT
  CHECK (restore_default_state IN ('captured', 'no_default')), restore_default_line_id TEXT,
  CHECK (mode = 'scheduled' OR ends_at IS NOT NULL),
  UNIQUE (account_id, idempotency_key)
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')), revision INTEGER,
  PRIMARY KEY (saved_search_id, reference_kind, reference_id),
  FOREIGN KEY (saved_search_id, line_account_id)
    REFERENCES saved_searches(id, line_account_id) ON DELETE RESTRICT
);

CREATE TABLE saved_search_revisions (
  saved_search_id TEXT NOT NULL,
  line_account_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  name TEXT NOT NULL,
  conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json)),
  is_shared INTEGER NOT NULL CHECK (is_shared IN (0, 1)),
  display_order INTEGER NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (saved_search_id, revision),
  FOREIGN KEY (saved_search_id, line_account_id)
    REFERENCES saved_searches(id, line_account_id) ON DELETE CASCADE
);

CREATE TABLE saved_search_usage_events (
  id TEXT PRIMARY KEY,
  saved_search_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  reference_kind TEXT NOT NULL
    CHECK (reference_kind IN ('friends','broadcast','automation','scenario','other')),
  reference_id TEXT,
  used_by TEXT,
  used_at TEXT NOT NULL,
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
, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE, condition_format TEXT NOT NULL DEFAULT 'search_v1'
  CHECK (condition_format IN ('search_v1','segment_v1')), revision INTEGER NOT NULL DEFAULT 1
  CHECK (revision >= 1), updated_by TEXT, updated_at TEXT);

CREATE TABLE scenario_action_fires (
  action_id TEXT NOT NULL REFERENCES scenario_actions (id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  fired_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (action_id, friend_id)
);

CREATE TABLE "scenario_actions" (
  id               TEXT PRIMARY KEY,
  scenario_id      TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  hook             TEXT NOT NULL CHECK (hook IN ('step_sent', 'scenario_completed', 'choice_selected')),
  step_id          TEXT REFERENCES scenario_steps (id) ON DELETE CASCADE,
  choice_index     INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  action_type      TEXT NOT NULL CHECK (action_type IN ('tag', 'friend_field', 'support_mark', 'scenario', 'common_var', 'send_message', 'send_template', 'reminder', 'event_booking')),
  config_json      TEXT NOT NULL CHECK (json_valid(config_json)),
  condition_json   TEXT CHECK (condition_json IS NULL OR json_valid(condition_json)),
  repeat_on_refire INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE scenario_drafts (
  scenario_id        TEXT PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  after_actions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(after_actions_json)),
  updated_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
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

CREATE TABLE "scenario_triggers" (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('friend_add', 'tag_added', 'form_answer', 'booking_confirmed')),
  tag_id TEXT REFERENCES tags (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
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
, line_account_id TEXT, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0, allow_concurrent INTEGER NOT NULL DEFAULT 0, audience_condition_json TEXT, on_complete_mode TEXT NOT NULL DEFAULT 'pause', on_complete_scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL, created_from_recipe_id TEXT REFERENCES recipes(id), recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id));

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
, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL, host TEXT);

CREATE TABLE site_tracking_keys (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL UNIQUE REFERENCES line_accounts(id) ON DELETE CASCADE,
  tracking_key    TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE site_visitors (
  id            TEXT PRIMARY KEY,
  friend_id     TEXT REFERENCES friends(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  linked_at     TEXT,
  linked_by     TEXT CHECK (linked_by IS NULL OR linked_by IN ('entry_route','liff','form','manual'))
, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL);

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
  CHECK (account_scope IN ('all', 'accounts')), policy_version INTEGER NOT NULL DEFAULT 1);

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

CREATE TABLE staff_two_factor_setup_attempts (
  staff_id          TEXT PRIMARY KEY,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
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

CREATE TABLE support_mark_archive_requests (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id),
  mark_id           TEXT NOT NULL REFERENCES support_marks(id),
  idempotency_key   TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_json     TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at        TEXT NOT NULL,
  UNIQUE(line_account_id, idempotency_key)
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
, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT, created_by TEXT, updated_by TEXT);

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
, group_id TEXT REFERENCES tag_groups(id) ON DELETE SET NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, is_starred INTEGER NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0, line_account_id TEXT REFERENCES line_accounts(id), description TEXT, normalized_name TEXT, manual_assignment_allowed INTEGER NOT NULL DEFAULT 1
  CHECK (manual_assignment_allowed IN (0, 1)), reapply_policy TEXT NOT NULL DEFAULT 'first_only'
  CHECK (reapply_policy IN ('first_only', 'every_time')), linked_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (linked_enabled IN (0, 1)), status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived')), version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_by TEXT, updated_by TEXT, updated_at TEXT, created_from_recipe_id TEXT REFERENCES recipes(id), recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id));

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
, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0, line_account_id TEXT REFERENCES line_accounts(id), created_from_recipe_id TEXT REFERENCES recipes(id), recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id));

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

CREATE TABLE uid_migration_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES uid_migration_runs(id) ON DELETE RESTRICT,
  old_uid TEXT NOT NULL,
  new_uid TEXT,
  old_friend_id TEXT REFERENCES friends(id) ON DELETE RESTRICT,
  new_friend_id TEXT REFERENCES friends(id) ON DELETE RESTRICT,
  candidate_name TEXT,
  evidence_type TEXT NOT NULL
    CHECK (evidence_type IN ('same_provider','line_login','signed_customer_id','verified_contact','operator_csv','manual')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  classification TEXT NOT NULL
    CHECK (classification IN ('auto','review','unmatched','conflict')),
  conflict_reason TEXT,
  decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','link','create','exclude')),
  decided_by TEXT,
  decided_at TEXT,
  result TEXT NOT NULL DEFAULT 'pending'
    CHECK (result IN ('pending','applied','skipped','failed','rolled_back')),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE uid_migration_runs (
  id TEXT PRIMARY KEY,
  from_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  to_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('csv','verified_api','manual')),
  source_filename TEXT,
  source_checksum TEXT,
  status TEXT NOT NULL DEFAULT 'dry_run'
    CHECK (status IN ('dry_run','review','ready','executing','completed','failed','rolled_back')),
  dry_run_revision INTEGER NOT NULL DEFAULT 1 CHECK (dry_run_revision >= 1),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  auto_count INTEGER NOT NULL DEFAULT 0 CHECK (auto_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  unmatched_count INTEGER NOT NULL DEFAULT 0 CHECK (unmatched_count >= 0),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  applied_count INTEGER NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  executed_at TEXT,
  completed_at TEXT,
  rolled_back_at TEXT,
  failure_reason TEXT,
  CHECK (from_account_id <> to_account_id),
  CHECK (total_count = auto_count + review_count + unmatched_count + conflict_count)
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

CREATE TABLE webhook_interaction_logs (
  id                 TEXT PRIMARY KEY,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
  webhook_id         TEXT,
  webhook_name       TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  trigger_summary    TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'retried')),
  request_body_json  TEXT,
  response_status    INTEGER,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  duration_ms        INTEGER,
  failure_reason     TEXT CHECK (
    failure_reason IS NULL OR failure_reason IN (
      'connection_failed', 'response_4xx', 'response_429',
      'response_5xx', 'processing_failed', 'unknown'
    )
  ),
  idempotency_key    TEXT NOT NULL,
  retry_of_id        TEXT REFERENCES webhook_interaction_logs(id) ON DELETE SET NULL,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE webinar_action_executions (
  id               TEXT PRIMARY KEY,
  webinar_action_id TEXT NOT NULL REFERENCES webinar_actions(id),
  webinar_id       TEXT NOT NULL REFERENCES webinars(id),
  friend_id        TEXT NOT NULL REFERENCES friends(id),
  session_start_at INTEGER,
  trigger          TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'succeeded', 'skipped', 'retry_wait', 'permanent_failed', 'cancelled')),
  attempt          INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT NOT NULL UNIQUE,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE webinar_actions (
  id            TEXT PRIMARY KEY,
  webinar_id    TEXT NOT NULL REFERENCES webinars(id),
  trigger       TEXT NOT NULL CHECK (trigger IN ('completed', 'cta_clicked', 'unviewed')),
  action_type   TEXT NOT NULL CHECK (action_type IN ('add_tag', 'remove_tag', 'start_scenario', 'stop_scenario', 'resume_scenario', 'send_message', 'send_webhook', 'switch_rich_menu', 'remove_rich_menu')),
  config_json   TEXT NOT NULL DEFAULT '{}',
  position      INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (webinar_id, trigger, position, version)
);

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

CREATE TABLE webinar_editor_settings (
  webinar_id                 TEXT PRIMARY KEY REFERENCES webinars(id) ON DELETE CASCADE,
  version                    INTEGER NOT NULL DEFAULT 1,
  delivery_kind              TEXT NOT NULL DEFAULT 'on_demand'
                             CHECK (delivery_kind IN ('on_demand', 'scheduled', 'external')),
  viewing_condition_json     TEXT NOT NULL DEFAULT '{"kind":"registered","label":"申込者向け"}',
  public_description         TEXT NOT NULL DEFAULT '',
  registration_form_id       TEXT REFERENCES forms(id) ON DELETE SET NULL,
  notification_messages_json TEXT NOT NULL DEFAULT '{}',
  notification_test_json     TEXT,
  action_template_body       TEXT NOT NULL DEFAULT '',
  missing_result_policy      TEXT NOT NULL DEFAULT 'escalate'
                             CHECK (missing_result_policy IN ('escalate', 'retry_next_day')),
  public_page_test_json       TEXT,
  published_version          INTEGER,
  published_at               TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
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

CREATE TABLE webinar_notification_jobs (
  id                TEXT PRIMARY KEY,
  webinar_id        TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  registration_id   TEXT NOT NULL REFERENCES webinar_registrations(id) ON DELETE CASCADE,
  friend_id         TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  session_start_at  INTEGER NOT NULL,
  settings_version  INTEGER NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
    'day_before', 'hour_before', 'session_start', 'missed', 'completed'
  )),
  scheduled_at      INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN (
                      'queued', 'claimed', 'succeeded', 'skipped',
                      'retry_wait', 'permanent_failed', 'cancelled'
                    )),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  next_retry_at     INTEGER,
  lease_expires_at  INTEGER,
  line_retry_key    TEXT NOT NULL,
  line_request_id   TEXT,
  sent_at           TEXT,
  cancelled_at      TEXT,
  last_error_code   TEXT,
  last_error_message TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (registration_id, settings_version, kind)
);

CREATE TABLE webinar_notification_settings (
  webinar_id                  TEXT PRIMARY KEY REFERENCES webinars(id) ON DELETE CASCADE,
  version                     INTEGER NOT NULL DEFAULT 1,
  registration_enabled        INTEGER NOT NULL DEFAULT 1,
  day_before_enabled          INTEGER NOT NULL DEFAULT 1,
  day_before_time_minutes     INTEGER NOT NULL DEFAULT 1200,
  hour_before_enabled         INTEGER NOT NULL DEFAULT 1,
  hour_before_minutes         INTEGER NOT NULL DEFAULT 60,
  start_enabled               INTEGER NOT NULL DEFAULT 1,
  missed_enabled              INTEGER NOT NULL DEFAULT 1,
  missed_time_minutes         INTEGER NOT NULL DEFAULT 600,
  completed_enabled           INTEGER NOT NULL DEFAULT 1,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  CHECK (day_before_time_minutes BETWEEN 0 AND 1439),
  CHECK (hour_before_minutes BETWEEN 1 AND 10080),
  CHECK (missed_time_minutes BETWEEN 0 AND 1439)
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
  created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'cancelled')), cancelled_at TEXT,
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

CREATE TABLE webinar_versions (
  id            TEXT PRIMARY KEY,
  webinar_id    TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  state         TEXT NOT NULL DEFAULT 'draft'
                CHECK (state IN ('draft', 'published', 'superseded')),
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  published_at  TEXT,
  UNIQUE (webinar_id, version)
);

CREATE TABLE webinar_view_segments (
  id               TEXT PRIMARY KEY,
  webinar_id       TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  session_start_at INTEGER NOT NULL,
  start_seconds    INTEGER NOT NULL CHECK (start_seconds >= 0),
  end_seconds      INTEGER NOT NULL CHECK (end_seconds > start_seconds),
  received_at      TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE
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
, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, publication_starts_at TEXT, publication_ends_at TEXT);

CREATE INDEX idx_account_handovers_from ON account_handovers (from_account_id);

CREATE INDEX idx_account_handovers_status ON account_handovers (status);

CREATE INDEX idx_action_score_rule_sets_account_status
  ON action_score_rule_sets(line_account_id, status);

CREATE INDEX idx_action_score_rule_versions_set_status
  ON action_score_rule_versions(rule_set_id, status, version_number DESC);

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

CREATE INDEX idx_affiliate_bank_profiles_scope
  ON affiliate_bank_profiles(organization_id, line_account_id, affiliate_id);

CREATE INDEX idx_affiliate_clicks_affiliate ON affiliate_clicks (affiliate_id);

CREATE INDEX idx_affiliate_links_affiliate ON affiliate_links (affiliate_id);

CREATE INDEX idx_affiliate_links_offer ON affiliate_links (offer_id);

CREATE UNIQUE INDEX idx_affiliate_payout_batches_idempotency
  ON affiliate_payout_batches(organization_id, line_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_affiliate_reward_entries_scope_status
  ON affiliate_reward_entries(organization_id, line_account_id, affiliate_id, status, created_at DESC);

CREATE UNIQUE INDEX idx_affiliate_settlement_lines_adjustment
  ON affiliate_settlement_lines(adjustment_id) WHERE adjustment_id IS NOT NULL;

CREATE UNIQUE INDEX idx_affiliate_settlement_lines_entry
  ON affiliate_settlement_lines(entry_id) WHERE entry_id IS NOT NULL;

CREATE INDEX idx_affiliate_settlements_scope_created
  ON affiliate_settlements(organization_id, line_account_id, affiliate_id, created_at DESC);

CREATE UNIQUE INDEX idx_affiliate_statements_idempotency
  ON affiliate_statements(organization_id, line_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_affiliates_friend ON affiliates (friend_id) WHERE friend_id IS NOT NULL;

CREATE INDEX idx_affiliates_tenant_account_created
  ON affiliates(tenant_id, line_account_id, created_at DESC);

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

CREATE INDEX idx_analytics_report_runs_history
  ON analytics_report_runs(line_account_id, schedule_id, scheduled_for DESC);

CREATE INDEX idx_analytics_report_schedules_due
  ON analytics_report_schedules(status, next_run_at, line_account_id);

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

CREATE INDEX idx_audit_events_account_created
  ON audit_events (line_account_id, created_at DESC);

CREATE INDEX idx_audit_events_action_created
  ON audit_events (action, created_at DESC);

CREATE INDEX idx_audit_events_actor_created
  ON audit_events (actor_principal_id, created_at DESC);

CREATE INDEX idx_audit_events_tenant_created
  ON audit_events (tenant_id, created_at DESC);

CREATE INDEX idx_auth_step_up_grants_staff_expiry
  ON auth_step_up_grants(staff_id, expires_at);

CREATE INDEX idx_auto_replies_template_id ON auto_replies(template_id);

CREATE INDEX idx_auto_reply_action_runs_evaluation
  ON auto_reply_action_runs (evaluation_id, status);

CREATE INDEX idx_auto_reply_evaluation_details_evaluation
  ON auto_reply_evaluation_details (evaluation_id, evaluation_order);

CREATE INDEX idx_auto_reply_evaluations_account_time
  ON auto_reply_evaluations (line_account_id, evaluated_at DESC);

CREATE INDEX idx_auto_reply_evaluations_rule_time
  ON auto_reply_evaluations (winning_auto_reply_id, evaluated_at DESC);

CREATE INDEX idx_auto_reply_evaluations_status_time
  ON auto_reply_evaluations (status, evaluated_at DESC);

CREATE INDEX idx_auto_reply_hits_friend ON auto_reply_hits(auto_reply_id, friend_id);

CREATE INDEX idx_auto_reply_hits_rule   ON auto_reply_hits(auto_reply_id, hit_at);

CREATE INDEX idx_auto_reply_versions_current
  ON auto_reply_versions (auto_reply_id, version_number DESC);

CREATE UNIQUE INDEX idx_auto_reply_versions_publish_key
  ON auto_reply_versions (publish_idempotency_key)
  WHERE publish_idempotency_key IS NOT NULL;

CREATE INDEX idx_auto_reply_versions_status
  ON auto_reply_versions (auto_reply_id, status, version_number DESC);

CREATE INDEX idx_automation_definitions_account_status
  ON automation_definitions(line_account_id, status, priority DESC);

CREATE INDEX idx_automation_logs_automation ON automation_logs (automation_id);

CREATE INDEX idx_automation_run_steps_common_action_metrics
  ON automation_run_steps(common_action_version_id, automation_run_id, status, step_key)
  WHERE common_action_version_id IS NOT NULL;

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

CREATE INDEX idx_automation_runs_definition_metrics
  ON automation_runs(automation_id, is_test, created_at DESC, status);

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

CREATE INDEX idx_booking_business_hours_setting_weekday
  ON booking_business_hours(booking_settings_id, weekday, start_time);

CREATE INDEX idx_booking_customers_account_name
  ON booking_customers(line_account_id, display_name);

CREATE INDEX idx_booking_customers_account_phone
  ON booking_customers(line_account_id, phone_normalized_hash);

CREATE INDEX idx_booking_exceptions_account_dates
  ON booking_availability_exceptions(line_account_id, date_from, date_to, scope_kind);

CREATE INDEX idx_booking_menu_resources_resource
  ON booking_menu_resources(resource_id, menu_id);

CREATE INDEX idx_booking_operation_runs_booking
  ON booking_operation_runs(line_account_id, booking_id, created_at DESC);

CREATE INDEX idx_booking_operation_runs_status
  ON booking_operation_runs(status, scheduled_at);

CREATE INDEX idx_booking_reminders_v298_status_scheduled
  ON booking_reminders(status, scheduled_at);

CREATE INDEX idx_booking_resources_account_active
  ON booking_resources(line_account_id, is_active, id);

CREATE INDEX idx_bookings_v298_account_status_starts
  ON bookings(line_account_id, status, starts_at);

CREATE INDEX idx_bookings_v298_customer_starts
  ON bookings(booking_customer_id, starts_at DESC);

CREATE INDEX idx_bookings_v298_friend_starts
  ON bookings(friend_id, starts_at DESC);

CREATE INDEX idx_bookings_v298_staff_overlap
  ON bookings(staff_id, status, starts_at, block_ends_at);

CREATE INDEX idx_broadcast_insights_broadcast_id ON broadcast_insights(broadcast_id);

CREATE INDEX idx_broadcast_insights_status ON broadcast_insights(status);

CREATE INDEX idx_broadcast_message_assets_account_kind
  ON broadcast_message_assets(line_account_id, kind, updated_at DESC);

CREATE INDEX idx_broadcast_saved_views_account_updated
  ON broadcast_saved_views(line_account_id, updated_at DESC, id);

CREATE INDEX idx_broadcast_tracked_links_link
  ON broadcast_tracked_links(tracked_link_id, broadcast_id);

CREATE INDEX idx_broadcasts_status_lookup ON broadcasts (status);

CREATE INDEX idx_calendar_bookings_friend ON calendar_bookings (friend_id);

CREATE INDEX idx_calendar_bookings_start ON calendar_bookings (start_at);

CREATE INDEX idx_carousel_taps_action ON carousel_taps(template_id, column_index, action_index);

CREATE INDEX idx_carousel_taps_friend ON carousel_taps(template_id, friend_id);

CREATE INDEX idx_chats_friend_status_message ON chats (friend_id, status, last_message_at);

CREATE UNIQUE INDEX idx_chats_friend_unique ON chats (friend_id);

CREATE INDEX idx_chats_operator ON chats (operator_id);

CREATE INDEX idx_chats_status ON chats (status);

CREATE INDEX idx_chats_unanswered_page
  ON chats (last_customer_message_at DESC, friend_id DESC)
  WHERE status != 'resolved' AND last_customer_message_at IS NOT NULL;

CREATE INDEX idx_codex_cloud_tasks_status
  ON codex_cloud_tasks(status, updated_at DESC);

CREATE INDEX idx_codex_cloud_tasks_thread
  ON codex_cloud_tasks(channel_id, thread_ts, detected_at DESC);

CREATE INDEX idx_common_action_binding_migrations_binding
  ON common_action_binding_migration_events(binding_id, created_at DESC);

CREATE INDEX idx_common_action_bindings_action
  ON common_action_bindings(common_action_id, common_action_version_id);

CREATE INDEX idx_common_action_bindings_consumer
  ON common_action_bindings(line_account_id, consumer_type, consumer_id);

CREATE INDEX idx_common_action_versions_action_status
  ON common_action_versions(common_action_id, status, version_number DESC);

CREATE INDEX idx_common_actions_account_status
  ON common_actions(line_account_id, status, updated_at DESC);

CREATE INDEX idx_common_var_replacement_runs_v338_source
  ON common_var_replacement_runs(source_common_var_id, created_at DESC);

CREATE INDEX idx_common_var_schedules_v338_pending
  ON common_var_schedules(var_id, effective_from) WHERE applied_at IS NULL;

CREATE INDEX idx_common_var_versions_v338_history
  ON common_var_versions(common_var_id, version_no DESC);

CREATE INDEX idx_common_vars_v338_account_active
  ON common_vars(line_account_id, archived_at, name, id);

CREATE INDEX idx_common_vars_v338_account_name
  ON common_vars(line_account_id, name, id);

CREATE INDEX idx_conversion_definition_operations_point
  ON conversion_definition_operations(conversion_point_id, created_at DESC);

CREATE INDEX idx_conversion_definition_usages_account
  ON conversion_definition_usages(line_account_id, ref_kind, ref_id);

CREATE INDEX idx_conversion_definition_usages_point
  ON conversion_definition_usages(conversion_point_id, created_at DESC);

CREATE UNIQUE INDEX idx_conversion_definition_usages_reference
  ON conversion_definition_usages(
    conversion_point_id,
    line_account_id,
    ref_kind,
    ref_id,
    COALESCE(ref_version_id, '')
  );

CREATE INDEX idx_conversion_events_affiliate ON conversion_events (affiliate_code);

CREATE INDEX idx_conversion_events_created_friend ON conversion_events(created_at, friend_id);

CREATE INDEX idx_conversion_events_friend ON conversion_events (friend_id);

CREATE INDEX idx_conversion_events_point ON conversion_events (conversion_point_id);

CREATE UNIQUE INDEX idx_conversion_events_point_idempotency
  ON conversion_events(conversion_point_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_conversion_points_status ON conversion_points(status, created_at DESC);

CREATE INDEX idx_customer_notification_definitions_account
  ON customer_notification_definitions(line_account_id, status, category, name, id);

CREATE INDEX idx_dashboard_preferences_account
  ON dashboard_preferences(line_account_id, updated_at DESC);

CREATE INDEX idx_ec_action_attempts_execution
  ON ec_action_execution_attempts(action_execution_id, attempt_number DESC);

CREATE INDEX idx_ec_action_executions_account_status
  ON ec_action_executions(line_account_id, status, updated_at DESC);

CREATE INDEX idx_ec_action_executions_event
  ON ec_action_executions(event_id, created_at);

CREATE INDEX idx_ec_connectors_status
  ON ec_connectors(status, updated_at DESC);

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

CREATE INDEX idx_ec_order_lines_order
  ON ec_order_lines(order_id, line_index);

CREATE INDEX idx_ec_orders_account_ordered
  ON ec_orders(line_account_id, ordered_at DESC, id DESC);

CREATE INDEX idx_ec_orders_customer
  ON ec_orders(line_account_id, customer_id, ordered_at DESC);

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

CREATE INDEX idx_entry_routes_line_account_active
  ON entry_routes(line_account_id, is_active, name, id);

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

CREATE INDEX idx_event_waitlist_offer_expiry
  ON event_waitlist(status, offer_expires_at);

CREATE INDEX idx_event_waitlist_promotion_due
  ON event_waitlist_promotion_jobs(status, available_at, created_at);

CREATE INDEX idx_event_waitlist_slot_created
  ON event_waitlist(slot_id, status, created_at);

CREATE UNIQUE INDEX idx_event_waitlist_slot_identity
  ON event_waitlist(slot_id, identity_key)
  WHERE status IN ('waiting', 'offered', 'accepted');

CREATE INDEX idx_events_account_published_sort ON events (line_account_id, is_published, sort_order);

CREATE INDEX idx_ffv_field ON friend_field_values(field_id, value);

CREATE INDEX idx_field_migration_items_status
  ON field_migration_items(run_id, status, friend_id);

CREATE UNIQUE INDEX idx_field_migration_runs_idempotency
  ON field_migration_runs(tenant_id, line_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_field_migration_runs_scope
  ON field_migration_runs(tenant_id, line_account_id, created_at DESC);

CREATE INDEX idx_folders_kind_order ON folders(kind, display_order);

CREATE INDEX idx_folders_webinar_account_order_333
  ON folders(kind, account_id, display_order, name);

CREATE INDEX idx_form_accounts_account
  ON form_accounts(line_account_id, form_id);

CREATE INDEX idx_form_opens_form ON form_opens (form_id, opened_at);

CREATE INDEX idx_form_submissions_form ON form_submissions (form_id);

CREATE INDEX idx_form_submissions_form_friend
  ON form_submissions (form_id, friend_id);

CREATE INDEX idx_form_submissions_form_write_status
  ON form_submissions(form_id, destination_write_status, created_at DESC);

CREATE INDEX idx_form_submissions_friend ON form_submissions (friend_id);

CREATE INDEX idx_forms_status_updated
  ON forms(status, updated_at DESC);

CREATE INDEX idx_friend_add_action_runs_event_status
  ON friend_add_action_runs(event_id, status, created_at, id);

CREATE INDEX idx_friend_add_action_runs_retry
  ON friend_add_action_runs (status, next_retry_at);

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

CREATE INDEX idx_friend_add_events_rule_time
  ON friend_add_events(line_account_id, routing_rule_id, occurred_at DESC, id DESC);

CREATE UNIQUE INDEX idx_friend_add_routing_one_draft
  ON friend_add_routing_versions (line_account_id)
  WHERE status = 'draft';

CREATE UNIQUE INDEX idx_friend_add_routing_one_published
  ON friend_add_routing_versions (line_account_id)
  WHERE status = 'published';

CREATE INDEX idx_friend_add_routing_versions_status
  ON friend_add_routing_versions (line_account_id, status, version_number DESC);

CREATE INDEX idx_friend_add_rule_folders_account_name
  ON friend_add_rule_folders(line_account_id, name, id);

CREATE UNIQUE INDEX idx_friend_add_rule_versions_one_draft
  ON friend_add_rule_versions (rule_id)
  WHERE status = 'draft';

CREATE UNIQUE INDEX idx_friend_add_rule_versions_one_published
  ON friend_add_rule_versions (rule_id)
  WHERE status = 'published';

CREATE INDEX idx_friend_add_rules_account_kind_priority
  ON friend_add_rules (line_account_id, friend_kind, priority, created_at);

CREATE UNIQUE INDEX idx_friend_add_rules_create_idempotency
  ON friend_add_rules (line_account_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_friend_add_rules_stop_idempotency
  ON friend_add_rules(line_account_id, stop_idempotency_key)
  WHERE stop_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_friend_add_rules_unknown_fallback
  ON friend_add_rules (line_account_id, friend_kind)
  WHERE is_unknown_route_fallback = 1 AND archived_at IS NULL;

CREATE INDEX idx_friend_bulk_run_items_work
  ON friend_bulk_run_items(run_id, status, retry_at, lease_expires_at, ordinal);

CREATE INDEX idx_friend_bulk_runs_actor
  ON friend_bulk_runs(tenant_id, created_by, created_at DESC);

CREATE INDEX idx_friend_bulk_runs_due
  ON friend_bulk_runs(status, scheduled_at, updated_at);

CREATE INDEX idx_friend_daily_snapshots_date
  ON friend_daily_snapshots (line_account_id, date);

CREATE INDEX idx_friend_export_jobs_account
  ON friend_export_jobs(line_account_id, created_at DESC);

CREATE INDEX idx_friend_field_scopes_account
  ON friend_field_scopes(tenant_id, line_account_id);

CREATE INDEX idx_friend_fields_order ON friend_fields(display_order, id);

CREATE UNIQUE INDEX idx_friend_identity_links_active_friend
  ON friend_identity_links(friend_id) WHERE unlinked_at IS NULL;

CREATE INDEX idx_friend_identity_links_user
  ON friend_identity_links(tenant_id, user_id, linked_at DESC);

CREATE INDEX idx_friend_import_jobs_account
  ON friend_import_jobs(line_account_id, created_at DESC);

CREATE INDEX idx_friend_reminders_friend ON friend_reminders (friend_id);

CREATE UNIQUE INDEX idx_friend_reminders_source_event
  ON friend_reminders (reminder_id, friend_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX idx_friend_reminders_status ON friend_reminders (status);

CREATE INDEX idx_friend_scenarios_due_delivery
ON friend_scenarios (next_delivery_at, id)
WHERE status = 'active' AND next_delivery_at IS NOT NULL;

CREATE INDEX idx_friend_scenarios_friend_id ON friend_scenarios (friend_id);

CREATE INDEX idx_friend_scenarios_next_delivery_at ON friend_scenarios (next_delivery_at);

CREATE INDEX idx_friend_scenarios_status ON friend_scenarios (status);

CREATE UNIQUE INDEX idx_friend_scenarios_unique ON friend_scenarios (friend_id, scenario_id) WHERE status != 'completed';

CREATE UNIQUE INDEX idx_friend_scores_account_idempotency
  ON friend_scores(line_account_id, idempotency_key)
  WHERE line_account_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE INDEX idx_friend_scores_created ON friend_scores (created_at);

CREATE INDEX idx_friend_scores_friend ON friend_scores (friend_id);

CREATE INDEX idx_friend_scores_rule_frequency
  ON friend_scores(line_account_id, friend_id, rule_key, frequency_key, occurred_at);

CREATE INDEX idx_friend_scores_source_event
  ON friend_scores(line_account_id, source, source_event_id);

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

CREATE INDEX idx_handover_decisions_handover
  ON account_handover_decisions (handover_id);

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

CREATE INDEX idx_line_account_connection_checks_correlation
  ON line_account_connection_checks(correlation_id);

CREATE INDEX idx_line_account_connection_checks_latest
  ON line_account_connection_checks(line_account_id, checked_at DESC);

CREATE INDEX idx_line_accounts_archived
  ON line_accounts (archived_at, display_order, created_at);

CREATE INDEX idx_line_accounts_display_order
  ON line_accounts (display_order, created_at);

CREATE UNIQUE INDEX idx_line_accounts_one_default_per_tenant
  ON line_accounts (COALESCE(tenant_id, '00000000-0000-4000-8000-000000000001'))
  WHERE is_default = 1;

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

CREATE INDEX idx_manual_link_check_history_v316_key_time
  ON manual_link_check_history(link_key, checked_at DESC);

CREATE INDEX idx_manual_links_status ON manual_links (status);

CREATE INDEX idx_media_account_created
  ON media(line_account_id, created_at DESC, id);

CREATE INDEX idx_media_kind ON media(kind, created_at DESC);

CREATE INDEX idx_media_upload_sessions_account_status
  ON media_upload_sessions(line_account_id, status, expires_at);

CREATE INDEX idx_media_upload_sessions_target
  ON media_upload_sessions(target_media_id, status, created_at DESC);

CREATE INDEX idx_media_usages_media_scanned
  ON media_usages (media_id, scanned_at);

CREATE INDEX idx_media_versions_media_created
  ON media_versions(media_id, version_no DESC, created_at DESC);

CREATE INDEX idx_meet_callback_receipts_received
  ON meet_callback_receipts(received_at);

CREATE INDEX idx_meet_consultation_reminders_due
  ON meet_consultation_reminders (status, scheduled_at);

CREATE INDEX idx_meet_consultations_friend ON meet_consultations (friend_id);

CREATE INDEX idx_meet_consultations_start ON meet_consultations (status, starts_at);

CREATE INDEX idx_menus_account_sort ON menus (line_account_id, sort_order);

CREATE INDEX idx_messages_account_direction_created ON messages_log(line_account_id, direction, created_at);

CREATE INDEX idx_messages_log_broadcast_friend_direction
  ON messages_log (broadcast_id, friend_id, direction);

CREATE INDEX idx_messages_log_broadcast_id ON messages_log(broadcast_id);

CREATE INDEX idx_messages_log_created_at ON messages_log (created_at);

CREATE INDEX idx_messages_log_friend_direction_created ON messages_log (friend_id, direction, created_at);

CREATE INDEX idx_messages_log_friend_direction_source_created
  ON messages_log (friend_id, direction, source, created_at DESC);

CREATE INDEX idx_messages_log_friend_id ON messages_log (friend_id);

CREATE INDEX idx_messages_log_friend_source ON messages_log (friend_id, source);

CREATE INDEX idx_messages_log_origin
  ON messages_log (origin_kind, created_at);

CREATE INDEX idx_mileage_adjustment_notifications_retry
  ON mileage_adjustment_notifications(status, updated_at)
  WHERE status = 'failed';

CREATE INDEX idx_mileage_earning_rule_drafts_account
  ON mileage_earning_rule_drafts(line_account_id, updated_at DESC);

CREATE INDEX idx_mileage_event_queue_due
  ON mileage_event_queue(status, available_at, created_at);

CREATE INDEX idx_mileage_grant_lots_spend_order
  ON mileage_grant_lots(program_id, beneficiary_key, status, expires_at, available_at);

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

CREATE INDEX idx_mileage_redemptions_friend_created
  ON mileage_redemptions(beneficiary_friend_id, created_at DESC);

CREATE INDEX idx_mileage_redemptions_retry
  ON mileage_redemptions(status, next_retry_at)
  WHERE status = 'delivery_failed';

CREATE INDEX idx_mileage_redemptions_reward_created
  ON mileage_redemptions(reward_id, created_at DESC);

CREATE INDEX idx_mileage_reward_codes_available
  ON mileage_reward_codes(reward_version_id, status, created_at);

CREATE INDEX idx_mileage_reward_versions_reward_status
  ON mileage_reward_versions(reward_id, status, version_number DESC);

CREATE INDEX idx_mileage_rewards_account_status
  ON mileage_rewards(line_account_id, status, sort_order, updated_at DESC);

CREATE INDEX idx_mileage_rules_account ON mileage_rules(line_account_id);

CREATE INDEX idx_mileage_rules_match
  ON mileage_rules(program_id, event_type, source, is_active);

CREATE INDEX idx_mileage_spend_allocations_grant
  ON mileage_spend_allocations(grant_lot_id);

CREATE INDEX idx_nen_care_flags_friend_status
  ON nen_care_flags(friend_id, status);

CREATE INDEX idx_nen_care_flags_status ON nen_care_flags(status, detected_at DESC);

CREATE INDEX idx_nen_column_read_events_column
  ON nen_column_read_events(line_account_id, column_id, event_kind, occurred_at DESC);

CREATE INDEX idx_nen_column_read_events_friend
  ON nen_column_read_events(friend_id, occurred_at DESC);

CREATE INDEX idx_nen_columns_target_tag
  ON nen_columns(line_account_id, target_tag_id, delivery_status);

CREATE INDEX idx_nen_consultations_friend ON nen_consultation_logs(friend_id, created_at DESC);

CREATE INDEX idx_nen_consultations_v2_friend ON nen_consultation_logs_v2(friend_id, created_at DESC);

CREATE INDEX idx_nen_consultations_v2_safety ON nen_consultation_logs_v2(safety_level, created_at DESC);

CREATE INDEX idx_nen_delivery_jobs_account_schedule
  ON nen_delivery_jobs(line_account_id, scheduled_at DESC, id DESC);

CREATE INDEX idx_nen_delivery_jobs_due
  ON nen_delivery_jobs(status, scheduled_at);

CREATE INDEX idx_nen_delivery_jobs_friend
  ON nen_delivery_jobs(friend_id, created_at DESC);

CREATE INDEX idx_nen_friend_coupon_status
  ON nen_friend_add_coupon_issues(line_account_id, status, updated_at);

CREATE INDEX idx_nen_health_logs_friend_date
  ON nen_health_logs(friend_id, logged_on DESC);

CREATE INDEX idx_nen_health_logs_pet_date ON nen_health_logs(pet_id, logged_on DESC);

CREATE INDEX idx_nen_knowledge_animal ON nen_knowledge_articles(animal_type, is_active);

CREATE INDEX idx_nen_knowledge_authority
  ON nen_knowledge_articles(is_active, animal_type, authority_rank DESC);

CREATE INDEX idx_nen_member_rank ON nen_ec_member_snapshots(member_rank, purchase_amount DESC);

CREATE INDEX idx_nen_pet_profiles_birthday
  ON nen_pet_profiles(substr(birthday, 6, 2), friend_id);

CREATE INDEX idx_nen_pet_profiles_customer
  ON nen_pet_profiles(customer_id);

CREATE INDEX idx_nen_pet_profiles_friend
  ON nen_pet_profiles(friend_id);

CREATE INDEX idx_nen_photo_assessment_runs_photo_created
  ON nen_photo_assessment_runs(photo_id, created_at DESC);

CREATE INDEX idx_nen_photo_asset_jobs_photo_created
  ON nen_photo_asset_jobs(photo_id, created_at DESC);

CREATE INDEX idx_nen_photo_derivatives_photo_kind
  ON nen_photo_derivatives(photo_id, kind, source_version DESC);

CREATE INDEX idx_nen_photo_original_download_audit_photo
  ON nen_photo_original_download_audit(photo_id, created_at DESC);

CREATE INDEX idx_nen_photo_original_download_grants_expiry
  ON nen_photo_original_download_grants(line_account_id, requested_by, expires_at);

CREATE INDEX idx_nen_photo_placements_account_active
  ON nen_photo_publication_placements(line_account_id, active, created_at DESC);

CREATE INDEX idx_nen_photo_publications_account_status
  ON nen_photo_publications(line_account_id, status, published_at DESC);

CREATE UNIQUE INDEX idx_nen_photo_publications_idempotency
  ON nen_photo_publications(line_account_id, last_idempotency_key)
  WHERE last_idempotency_key IS NOT NULL;

CREATE INDEX idx_nen_photo_review_events_account_created
  ON nen_photo_review_events(line_account_id, created_at DESC);

CREATE INDEX idx_nen_photo_review_events_notification
  ON nen_photo_review_events(notification_status, created_at)
  WHERE notification_status IN ('pending', 'failed');

CREATE INDEX idx_nen_photo_reward_outbox_pending
  ON nen_photo_reward_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX idx_nen_photo_risks_photo_created
  ON nen_photo_risk_assessments(photo_id, created_at DESC);

CREATE INDEX idx_nen_photo_submissions_friend_status
  ON nen_photo_submissions(friend_id, status);

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

CREATE INDEX idx_notification_deliveries_account_status
  ON notification_deliveries(line_account_id, status, queued_at DESC, id DESC);

CREATE INDEX idx_notification_deliveries_retry
  ON notification_deliveries(status, retryable, next_retry_at);

CREATE INDEX idx_notification_interactions_delivery
  ON notification_interactions(delivery_id, clicked_at DESC);

CREATE INDEX idx_notification_metrics_account_date
  ON notification_aggregate_metrics(line_account_id, metric_date DESC, definition_id);

CREATE INDEX idx_notification_rules_account ON notification_rules(line_account_id, event_type, is_active);

CREATE INDEX idx_notifications_center ON notifications(line_account_id, category, created_at DESC);

CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE INDEX idx_notifications_status ON notifications (status);

CREATE INDEX idx_operation_audit_kind_date
  ON operation_audit (target_kind, created_at);

CREATE INDEX idx_operation_deployment_events_occurred
  ON operation_deployment_events(occurred_at DESC, id DESC);

CREATE INDEX idx_operation_health_results_run
  ON operation_health_results(run_id, check_key);

CREATE INDEX idx_operation_health_runs_scope_started
  ON operation_health_runs(scope_key, started_at DESC, id DESC);

CREATE INDEX idx_operation_incidents_scope_created
  ON operation_incidents(scope_key, created_at DESC, id DESC);

CREATE INDEX idx_operation_incidents_status_created
  ON operation_incidents(status, created_at DESC, id DESC);

CREATE INDEX idx_operation_notification_outbox_due
  ON operation_notification_outbox(status, next_attempt_at);

CREATE INDEX idx_outbound_send_requests_created
  ON outbound_send_requests(created_at);

CREATE INDEX idx_outgoing_webhooks_line_account
  ON outgoing_webhooks(line_account_id, is_active, updated_at DESC);

CREATE INDEX idx_recipe_clone_items_v316_run
  ON recipe_clone_items(run_id, created_at, id);

CREATE INDEX idx_recipe_clone_runs_v316_account
  ON recipe_clone_runs(line_account_id, created_at DESC);

CREATE INDEX idx_recipe_clone_runs_v316_recipe
  ON recipe_clone_runs(recipe_id, created_at DESC);

CREATE INDEX idx_ref_tracking_friend ON ref_tracking (friend_id);

CREATE INDEX idx_ref_tracking_friend_created ON ref_tracking(friend_id, created_at);

CREATE INDEX idx_ref_tracking_ref    ON ref_tracking (ref_code);

CREATE INDEX idx_ref_tracking_ref_created ON ref_tracking(ref_code, created_at);

CREATE INDEX idx_reminder_delivery_runs_due
  ON reminder_delivery_runs (status, next_retry_at, lease_expires_at, scheduled_at);

CREATE INDEX idx_reminder_delivery_runs_friend
  ON reminder_delivery_runs (friend_id, scheduled_at DESC);

CREATE UNIQUE INDEX idx_reminder_delivery_runs_message_log
  ON reminder_delivery_runs (message_log_id)
  WHERE message_log_id IS NOT NULL;

CREATE INDEX idx_reminder_delivery_runs_reminder
  ON reminder_delivery_runs (line_account_id, reminder_id, scheduled_at DESC);

CREATE INDEX idx_reminder_steps_by_reminder ON reminder_steps (reminder_id);

CREATE INDEX idx_reminder_version_steps_order
  ON reminder_version_steps (reminder_version_id, position, stable_step_id);

CREATE UNIQUE INDEX idx_reminder_versions_one_draft
  ON reminder_versions (reminder_id) WHERE status = 'draft';

CREATE UNIQUE INDEX idx_reminder_versions_one_published
  ON reminder_versions (reminder_id) WHERE status = 'published';

CREATE INDEX idx_reminder_versions_status
  ON reminder_versions (reminder_id, status, version_number DESC);

CREATE INDEX idx_reminders_display_order ON reminders(display_order, created_at);

CREATE INDEX idx_reminders_folder ON reminders(folder_id);

CREATE INDEX idx_reminders_visible_order
  ON reminders (line_account_id, display_order, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_rich_menu_area_taps_area  ON rich_menu_area_taps(area_id, tapped_at);

CREATE INDEX idx_rich_menu_area_taps_group ON rich_menu_area_taps(group_id, tapped_at);

CREATE INDEX idx_rich_menu_areas_page     ON rich_menu_areas(page_id);

CREATE INDEX idx_rich_menu_assignment_runs_monthly
  ON rich_menu_assignment_runs (line_account_id, group_id, status, completed_at, friend_id);

CREATE INDEX idx_rich_menu_assignments_group
  ON rich_menu_assignments (line_account_id, group_id);

CREATE INDEX idx_rich_menu_groups_account ON rich_menu_groups(account_id, status);

CREATE INDEX idx_rich_menu_pages_group    ON rich_menu_pages(group_id, order_index);

CREATE INDEX idx_rich_menu_schedules_due
  ON rich_menu_schedules (status, starts_at, ends_at);

CREATE INDEX idx_rich_menu_schedules_group
  ON rich_menu_schedules (group_id, created_at DESC);

CREATE INDEX idx_rich_menu_schedules_lease
  ON rich_menu_schedules (status, lease_expires_at);

CREATE INDEX idx_rich_menu_schedules_retry
  ON rich_menu_schedules (status, next_retry_at);

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

CREATE INDEX idx_saved_search_usage_month
  ON saved_search_usage_events(line_account_id, saved_search_id, used_at);

CREATE INDEX idx_saved_search_usage_reference
  ON saved_search_usage_events(
    line_account_id, saved_search_id, reference_kind, reference_id, used_at
  );

CREATE INDEX idx_saved_searches_account_format
  ON saved_searches(line_account_id, scope, condition_format, created_by, display_order);

CREATE INDEX idx_saved_searches_account_scope
  ON saved_searches(line_account_id, scope, created_by, display_order);

CREATE UNIQUE INDEX idx_saved_searches_id_account
  ON saved_searches(id, line_account_id);

CREATE INDEX idx_saved_searches_scope ON saved_searches(scope, display_order);

CREATE INDEX idx_scenario_actions_lookup
  ON scenario_actions (scenario_id, hook, step_id, choice_index, sort_order);

CREATE INDEX idx_scenario_drafts_account_updated
  ON scenario_drafts(line_account_id, updated_at DESC, scenario_id);

CREATE INDEX idx_scenario_steps_scenario_lookup ON scenario_steps (scenario_id);

CREATE INDEX idx_scenario_triggers_lookup ON scenario_triggers (kind, tag_id);

CREATE UNIQUE INDEX idx_scenario_triggers_unique
  ON scenario_triggers (scenario_id, kind, COALESCE(tag_id, ''));

CREATE INDEX idx_scenarios_order ON scenarios (display_order);

CREATE INDEX idx_schedule_publications_schedule
  ON rich_menu_schedule_publications (schedule_id, kind);

CREATE INDEX idx_shifts_staff_date ON staff_shifts (staff_id, work_date);

CREATE INDEX idx_site_events_account_host_path
  ON site_events(line_account_id, host, path, occurred_at);

CREATE INDEX idx_site_events_account_occurred ON site_events(line_account_id, occurred_at);

CREATE INDEX idx_site_events_friend ON site_events(friend_id, occurred_at);

CREATE INDEX idx_site_events_path ON site_events(path, occurred_at);

CREATE INDEX idx_site_visitors_account ON site_visitors(line_account_id);

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

CREATE INDEX idx_support_mark_archive_requests_mark
  ON support_mark_archive_requests(line_account_id, mark_id, created_at DESC);

CREATE INDEX idx_support_mark_scopes_account
  ON support_mark_scopes(tenant_id, line_account_id);

CREATE INDEX idx_support_marks_active
  ON support_marks(archived_at, display_order, created_at);

CREATE INDEX idx_tag_groups_sort ON tag_groups(sort_order, id);

CREATE UNIQUE INDEX idx_tags_account_normalized_name
  ON tags(line_account_id, normalized_name)
  WHERE line_account_id IS NOT NULL AND normalized_name IS NOT NULL;

CREATE INDEX idx_tags_account_status_name
  ON tags(line_account_id, status, name, id);

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

CREATE INDEX idx_uid_migration_items_old_uid
  ON uid_migration_items(run_id, old_uid);

CREATE INDEX idx_uid_migration_items_run
  ON uid_migration_items(run_id, classification, decision);

CREATE INDEX idx_uid_migration_runs_accounts
  ON uid_migration_runs(from_account_id, to_account_id, created_at DESC);

CREATE INDEX idx_uid_migration_runs_status
  ON uid_migration_runs(status, created_at DESC);

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

CREATE INDEX idx_webhook_interactions_account_created
  ON webhook_interaction_logs (line_account_id, created_at DESC);

CREATE INDEX idx_webhook_interactions_account_status
  ON webhook_interaction_logs (line_account_id, status, created_at DESC);

CREATE INDEX idx_webhook_interactions_connection_period
  ON webhook_interaction_logs(line_account_id, webhook_id, created_at DESC, status);

CREATE INDEX idx_webhook_interactions_webhook
  ON webhook_interaction_logs (line_account_id, webhook_id, created_at DESC);

CREATE INDEX idx_webinar_action_executions_status
  ON webinar_action_executions (status, updated_at);

CREATE INDEX idx_webinar_action_executions_webinar
  ON webinar_action_executions (webinar_id, created_at);

CREATE INDEX idx_webinar_actions_webinar
  ON webinar_actions (webinar_id, trigger, position);

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

CREATE INDEX idx_webinar_notification_jobs_due
  ON webinar_notification_jobs (status, scheduled_at, next_retry_at);

CREATE INDEX idx_webinar_notification_jobs_webinar
  ON webinar_notification_jobs (webinar_id, created_at);

CREATE INDEX idx_webinar_picker_opens_opened
  ON webinar_picker_opens (webinar_id, opened_at);

CREATE INDEX idx_webinar_regs_active_friend
  ON webinar_registrations (webinar_id, friend_id, status, session_start_at);

CREATE INDEX idx_webinar_regs_due
  ON webinar_registrations (notified_at, session_start_at);

CREATE INDEX idx_webinar_regs_friend
  ON webinar_registrations (webinar_id, friend_id);

CREATE INDEX idx_webinar_user_comments_webinar
  ON webinar_user_comments (webinar_id, created_at);

CREATE INDEX idx_webinar_versions_state
  ON webinar_versions (webinar_id, state, version DESC);

CREATE INDEX idx_webinar_view_segments_coverage
  ON webinar_view_segments (webinar_id, start_seconds, end_seconds);

CREATE INDEX idx_webinar_viewers_webinar
  ON webinar_viewers (webinar_id, session_start_at);

CREATE INDEX idx_webinars_account_status_folder
  ON webinars (account_id, status, folder_id);

CREATE UNIQUE INDEX uq_google_calendar_connections_active_staff
  ON google_calendar_connections (staff_id)
  WHERE staff_id IS NOT NULL AND is_active = 1;

CREATE TRIGGER analytics_projection_friend_stage_count
AFTER INSERT ON analytics_projection_friend_stage
BEGIN UPDATE analytics_projection_metric_stage SET unique_friend_count = unique_friend_count + 1 WHERE line_account_id = NEW.line_account_id AND cycle_id = NEW.cycle_id AND metric_date = NEW.metric_date AND event_type = NEW.event_type; END;

CREATE TRIGGER conversion_points_prevent_delete
BEFORE DELETE ON conversion_points
WHEN EXISTS (
  SELECT 1 FROM conversion_events WHERE conversion_point_id = OLD.id
) OR EXISTS (
  SELECT 1 FROM conversion_definition_usages WHERE conversion_point_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'conversion point with events or usages cannot be deleted'); END;

CREATE TRIGGER trg_action_score_published_version_immutable
BEFORE UPDATE ON action_score_rule_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published action score version is immutable'); END;

CREATE TRIGGER trg_action_score_published_version_no_delete
BEFORE DELETE ON action_score_rule_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published action score version cannot be deleted'); END;

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

CREATE TRIGGER trg_analytics_report_runs_snapshot_immutable
BEFORE UPDATE OF period_from, period_to, time_zone, data_cutoff_at, result_json
ON analytics_report_runs
WHEN OLD.state != 'running'
BEGIN SELECT RAISE(ABORT, 'analytics_report_snapshot_immutable'); END;

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

CREATE TRIGGER trg_auto_reply_versions_immutable_delete
BEFORE DELETE ON auto_reply_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published auto reply versions cannot be deleted'); END;

CREATE TRIGGER trg_auto_reply_versions_immutable_update
BEFORE UPDATE OF auto_reply_id, version_number, line_account_id, definition_snapshot
ON auto_reply_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published auto reply versions are immutable'); END;

CREATE TRIGGER trg_auto_reply_versions_status_transition
BEFORE UPDATE OF status ON auto_reply_versions
WHEN OLD.status IN ('published', 'retired')
 AND NEW.status <> OLD.status
 AND NOT (OLD.status = 'published' AND NEW.status = 'retired')
BEGIN SELECT RAISE(ABORT, 'published auto reply version status cannot move backwards'); END;

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

CREATE TRIGGER trg_common_action_binding_migrations_no_delete
BEFORE DELETE ON common_action_binding_migration_events
BEGIN SELECT RAISE(ABORT, 'common action binding migration history cannot be deleted'); END;

CREATE TRIGGER trg_common_action_binding_migrations_no_update
BEFORE UPDATE ON common_action_binding_migration_events
BEGIN SELECT RAISE(ABORT, 'common action binding migration history is immutable'); END;

CREATE TRIGGER trg_common_action_published_version_immutable
BEFORE UPDATE ON common_action_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published common action version is immutable'); END;

CREATE TRIGGER trg_common_action_published_version_no_delete
BEFORE DELETE ON common_action_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published common action version cannot be deleted'); END;

CREATE TRIGGER trg_forms_revision_account_delete
AFTER DELETE ON form_accounts
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_account_insert
AFTER INSERT ON form_accounts
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_account_update
AFTER UPDATE OF form_id, line_account_id ON form_accounts
WHEN OLD.form_id IS NOT NEW.form_id OR OLD.line_account_id IS NOT NEW.line_account_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

CREATE TRIGGER trg_forms_revision_open_delete
AFTER DELETE ON form_opens
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_open_insert
AFTER INSERT ON form_opens
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_open_update
AFTER UPDATE OF form_id ON form_opens
WHEN OLD.form_id IS NOT NEW.form_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

CREATE TRIGGER trg_forms_revision_rich_menu_delete
AFTER DELETE ON rich_menu_areas
WHEN OLD.form_id IS NOT NULL
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_rich_menu_insert
AFTER INSERT ON rich_menu_areas
WHEN NEW.form_id IS NOT NULL
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_rich_menu_update
AFTER UPDATE OF form_id ON rich_menu_areas
WHEN OLD.form_id IS NOT NEW.form_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

CREATE TRIGGER trg_forms_revision_submission_delete
AFTER DELETE ON form_submissions
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_submission_insert
AFTER INSERT ON form_submissions
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_submission_update
AFTER UPDATE OF form_id ON form_submissions
WHEN OLD.form_id IS NOT NEW.form_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

CREATE TRIGGER trg_forms_revision_webinar_cta_delete
AFTER DELETE ON webinar_ctas
WHEN OLD.form_id IS NOT NULL
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_webinar_cta_insert
AFTER INSERT ON webinar_ctas
WHEN NEW.form_id IS NOT NULL
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_webinar_cta_update
AFTER UPDATE OF form_id ON webinar_ctas
WHEN OLD.form_id IS NOT NEW.form_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

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

CREATE TRIGGER trg_friend_add_rule_versions_immutable_delete
BEFORE DELETE ON friend_add_rule_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add rule versions cannot be deleted'); END;

CREATE TRIGGER trg_friend_add_rule_versions_immutable_update
BEFORE UPDATE OF rule_id, version_number, definition_snapshot
ON friend_add_rule_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published friend-add rule versions are immutable'); END;

CREATE TRIGGER trg_friend_scores_v6_snapshot
AFTER INSERT ON friend_scores
WHEN NEW.line_account_id IS NOT NULL
 AND NEW.operation IN ('delta', 'set', 'manual_adjustment')
 AND NEW.score_after IS NOT NULL
BEGIN UPDATE friends SET score = NEW.score_after, updated_at = COALESCE(NEW.occurred_at, NEW.created_at, updated_at) WHERE id = NEW.friend_id AND line_account_id = NEW.line_account_id; SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'action score friend account mismatch') END; END;

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

CREATE TRIGGER trg_mileage_grant_lot_after_ledger_insert
AFTER INSERT ON mileage_ledger
WHEN NEW.amount > 0
 AND NEW.status = 'available'
 AND NEW.entry_type IN ('grant', 'adjustment')
BEGIN
  INSERT OR IGNORE INTO mileage_grant_lots
    (ledger_entry_id, program_id, beneficiary_key, original_amount, remaining_amount,
     available_at, expires_at, status, created_at)
  SELECT NEW.id,
         NEW.program_id,
         CASE
           WHEN COALESCE(NEW.beneficiary_user_id, f.user_id) IS NOT NULL
             THEN 'user:' || COALESCE(NEW.beneficiary_user_id, f.user_id)
           ELSE 'friend:' || NEW.beneficiary_friend_id
         END,
         NEW.amount,
         NEW.amount,
         NEW.occurred_at,
         json_extract(NEW.metadata, '$.expiresAt'),
         'available',
         NEW.created_at
    FROM (SELECT 1) seed
    LEFT JOIN friends f ON f.id = NEW.beneficiary_friend_id; END;

CREATE TRIGGER trg_mileage_redemption_attempts_no_delete
BEFORE DELETE ON mileage_redemption_attempts
BEGIN SELECT RAISE(ABORT, 'mileage redemption attempt history cannot be deleted'); END;

CREATE TRIGGER trg_mileage_redemptions_no_delete
BEFORE DELETE ON mileage_redemptions
BEGIN SELECT RAISE(ABORT, 'mileage redemption history cannot be deleted'); END;

CREATE TRIGGER trg_mileage_reward_published_version_immutable
BEFORE UPDATE ON mileage_reward_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published mileage reward version is immutable'); END;

CREATE TRIGGER trg_mileage_reward_published_version_no_delete
BEFORE DELETE ON mileage_reward_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published mileage reward version cannot be deleted'); END;

CREATE TRIGGER trg_mileage_wallet_after_ledger_insert
AFTER INSERT ON mileage_ledger
WHEN NEW.beneficiary_friend_id IS NOT NULL OR NEW.beneficiary_user_id IS NOT NULL
BEGIN
  INSERT INTO mileage_wallets
    (program_id, beneficiary_key, beneficiary_user_id, beneficiary_friend_id,
     available, pending, version, updated_at)
  SELECT NEW.program_id,
         CASE
           WHEN COALESCE(NEW.beneficiary_user_id, f.user_id) IS NOT NULL
             THEN 'user:' || COALESCE(NEW.beneficiary_user_id, f.user_id)
           ELSE 'friend:' || NEW.beneficiary_friend_id
         END,
         COALESCE(NEW.beneficiary_user_id, f.user_id),
         CASE WHEN COALESCE(NEW.beneficiary_user_id, f.user_id) IS NULL
              THEN NEW.beneficiary_friend_id ELSE NULL END,
         CASE WHEN NEW.status = 'available' THEN NEW.amount ELSE 0 END,
         CASE WHEN NEW.status = 'pending' THEN NEW.amount ELSE 0 END,
         1,
         NEW.created_at
    FROM (SELECT 1) seed
    LEFT JOIN friends f ON f.id = NEW.beneficiary_friend_id
  ON CONFLICT(program_id, beneficiary_key) DO UPDATE SET
    available = mileage_wallets.available + excluded.available,
    pending = mileage_wallets.pending + excluded.pending,
    version = mileage_wallets.version + 1,
    updated_at = excluded.updated_at; END;

CREATE TRIGGER trg_reminder_version_steps_immutable_delete
BEFORE DELETE ON reminder_version_steps
WHEN COALESCE((SELECT status FROM reminder_versions WHERE id = OLD.reminder_version_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'published reminder version steps are immutable'); END;

CREATE TRIGGER trg_reminder_version_steps_immutable_insert
BEFORE INSERT ON reminder_version_steps
WHEN COALESCE((SELECT status FROM reminder_versions WHERE id = NEW.reminder_version_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'published reminder version steps are immutable'); END;

CREATE TRIGGER trg_reminder_version_steps_immutable_update
BEFORE UPDATE ON reminder_version_steps
WHEN COALESCE((SELECT status FROM reminder_versions WHERE id = OLD.reminder_version_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'published reminder version steps are immutable'); END;

CREATE TRIGGER trg_reminder_versions_immutable_delete
BEFORE DELETE ON reminder_versions
WHEN OLD.status IN ('published', 'superseded')
BEGIN SELECT RAISE(ABORT, 'published reminder versions cannot be deleted'); END;

CREATE TRIGGER trg_reminder_versions_immutable_update
BEFORE UPDATE OF reminder_id, version_number, settings_snapshot ON reminder_versions
WHEN OLD.status IN ('published', 'superseded')
BEGIN SELECT RAISE(ABORT, 'published reminder versions are immutable'); END;

CREATE TRIGGER trg_reminder_versions_status_transition
BEFORE UPDATE OF status ON reminder_versions
WHEN OLD.status IN ('published', 'superseded')
 AND NEW.status <> OLD.status
 AND NOT (OLD.status = 'published' AND NEW.status = 'superseded')
BEGIN SELECT RAISE(ABORT, 'published reminder version status cannot move backwards'); END;

-- Seed data required by tenant-aware inserts on a fresh database.
INSERT OR IGNORE INTO tenants (id, name) VALUES
  ('00000000-0000-4000-8000-000000000001', '既定の統括');
