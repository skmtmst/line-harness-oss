-- Migration 438: リッチメニュー運用の台帳 (#898〜#904 レーン)
--
-- 2つの台帳を足す。どちらも「同じ操作を何度押しても1回に数える」ために
-- (account_id, idempotency_key) の UNIQUE を持つ。
--
-- 1) rich_menu_duplicate_requests … N-154 下書き複製の記録。
--    同じ鍵のやり直しは同じ作成物を返し、別内容への鍵の使い回しは 409 にする。
--    source_group_id には外部キーを付けない。複製元を消しても「いつ・何から
--    複製したか」の履歴は残したいため。
--
-- 2) rich_menu_test_applies … N-152 本人LINEへのテスト適用の記録。
--    「誰の・どのLINEへ・適用前に何が出ていたか・どのメニューを出したか」を
--    残さないと、元へ戻す操作が冪等にできない。下書きのテストでは LINE 上に
--    lht: 名の専用メニューを作るので、掃除対象を test_shell_ids に持つ。

CREATE TABLE IF NOT EXISTS rich_menu_duplicate_requests (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_group_id   TEXT NOT NULL,
  created_group_id  TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_duplicate_requests_source
  ON rich_menu_duplicate_requests(source_group_id);

CREATE TABLE IF NOT EXISTS rich_menu_test_applies (
  id                    TEXT PRIMARY KEY,
  group_id              TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  staff_id              TEXT NOT NULL,
  line_user_id          TEXT NOT NULL,
  /** 適用前にその人へ出ていたLINEメニュー。無ければ NULL。戻す時の行き先。 */
  previous_richmenu_id  TEXT,
  /** previous を読み終えた印。0のままなら再開時に読み直す。 */
  previous_captured     INTEGER NOT NULL DEFAULT 0,
  /** 本人へ割り当てたメニュー(既定ページ)。公開済みなら既存ID、下書きなら lht: メニュー。 */
  applied_richmenu_id   TEXT,
  /** 下書きテストで作ったLINEメニューIDのJSON配列。戻す時に消す。 */
  test_shell_ids        TEXT,
  status                TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','applied','reverting','reverted','failed')),
  last_error_code       TEXT,
  idempotency_key       TEXT NOT NULL,
  revert_idempotency_key TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_test_applies_group
  ON rich_menu_test_applies(group_id, staff_id, status);
