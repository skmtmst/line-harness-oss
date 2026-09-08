import type Database from 'better-sqlite3';

// #652 新規試験用の軽量構成。全migration適用(1件あたりCIで1秒級)の代わりに、
// 対象の口が触る表だけを本番と同じ列で用意する。外部キー制約は付けない
// (参照整合の試験は全構成の既存試験とFK付き移行試験が担う)。
// 本番の列が増えたらここにも足す。足りない列があると試験が落ちて知らせる。
export function applyConversionTestSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE line_accounts (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      channel_access_token TEXT NOT NULL, channel_secret TEXT NOT NULL
    );
    CREATE TABLE friends (
      id TEXT PRIMARY KEY, line_user_id TEXT UNIQUE NOT NULL, display_name TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE affiliates (
      id TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1, friend_id TEXT
    );
    CREATE TABLE affiliate_links (
      id TEXT PRIMARY KEY, ref_code TEXT NOT NULL, affiliate_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE ref_tracking (
      id TEXT PRIMARY KEY, friend_id TEXT NOT NULL, ref_code TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE conversion_points (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, event_type TEXT NOT NULL, value REAL,
      measure_method TEXT NOT NULL DEFAULT 'manual', target_url TEXT,
      count_repeat INTEGER NOT NULL DEFAULT 1, attribution_days INTEGER,
      line_account_id TEXT, version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active', stopped_at TEXT,
      source_config_json TEXT NOT NULL DEFAULT '{}',
      deduplication_mode TEXT NOT NULL DEFAULT 'every',
      deduplication_window_days INTEGER,
      value_mode TEXT NOT NULL DEFAULT 'fixed',
      reversal_policy TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE conversion_events (
      id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL, friend_id TEXT NOT NULL,
      user_id TEXT, affiliate_code TEXT, metadata TEXT,
      affiliate_id TEXT, attributed_ref_code TEXT,
      approval_status TEXT, approved_at TEXT,
      point_name_snapshot TEXT, event_type_snapshot TEXT, value_snapshot REAL,
      idempotency_key TEXT, once_key TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE conversion_definition_usages (
      id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL,
      definition_version INTEGER NOT NULL, line_account_id TEXT NOT NULL,
      ref_kind TEXT NOT NULL, ref_id TEXT NOT NULL, ref_version_id TEXT,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE conversion_definition_operations (
      id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL, action TEXT NOT NULL,
      replacement_id TEXT, affected_usages INTEGER NOT NULL DEFAULT 0,
      reason TEXT, performed_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_conversion_events_point_idempotency
      ON conversion_events(conversion_point_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX idx_conversion_events_once_key
      ON conversion_events(once_key) WHERE once_key IS NOT NULL;
  `);
}
