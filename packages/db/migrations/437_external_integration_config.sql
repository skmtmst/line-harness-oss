-- #939 機能26 監査是正: 外部連携の設定を履歴を残す作りに直す。
--
-- N-368: 受信・送信Webhookの削除を物理削除から履歴保持へ変える。
--   行は消さず deleted_at に時刻を残し、読み取り・実行・集計は
--   `deleted_at IS NULL` の行だけを見る。削除した担当は deleted_by_staff_id へ。
--
-- N-367: 人が見つからなかった届物を置く箱。
--   照合に使った値(identity_attempts_json)と形だけの見本(masked_shape_json)を
--   残し、生の本文は保存しない。見つからなかった処理の内訳(kind)と
--   その後の扱い(status)を持つ。同じ受信の再送は UNIQUE で増やさない。
--
-- N-380: 外部システムが公開APIを呼ぶための合言葉の台帳。
--   管理画面の認証とは別。平文は保存せず SHA-256 の hash だけ持ち、
--   発行・再発行の応答にだけ1回出す。失効は revoked_at に時刻を残す。
--   再発行は旧行を失効させ、新しい行の rotated_from_id で系譜を残す。

ALTER TABLE incoming_webhooks ADD COLUMN deleted_at TEXT;
ALTER TABLE incoming_webhooks ADD COLUMN deleted_by_staff_id TEXT;
ALTER TABLE outgoing_webhooks ADD COLUMN deleted_at TEXT;
ALTER TABLE outgoing_webhooks ADD COLUMN deleted_by_staff_id TEXT;

CREATE TABLE incoming_webhook_unmatched_events (
  id                    TEXT PRIMARY KEY,
  webhook_id            TEXT NOT NULL REFERENCES incoming_webhooks(id),
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id),
  source_event_id       TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('unmatched', 'candidate')),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'resolved', 'dismissed')),
  identity_attempts_json TEXT NOT NULL DEFAULT '[]'
                        CHECK (json_valid(identity_attempts_json)),
  masked_shape_json     TEXT CHECK (masked_shape_json IS NULL OR json_valid(masked_shape_json)),
  resolved_friend_id    TEXT REFERENCES friends(id),
  resolved_by           TEXT,
  resolved_at           TEXT,
  received_at           TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (webhook_id, source_event_id)
);

CREATE INDEX idx_incoming_webhook_unmatched_account_status
  ON incoming_webhook_unmatched_events (line_account_id, status, received_at);

CREATE TABLE integration_api_tokens (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  name            TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  -- 一覧で「どれか」見分けるための先頭部分だけ。照合には使わない。
  token_prefix    TEXT NOT NULL,
  scopes          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scopes)),
  created_by      TEXT,
  last_used_at    TEXT,
  revoked_at      TEXT,
  revoked_by      TEXT,
  rotated_from_id TEXT REFERENCES integration_api_tokens(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX idx_integration_api_tokens_account
  ON integration_api_tokens (line_account_id, revoked_at);
