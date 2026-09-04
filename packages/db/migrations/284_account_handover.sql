-- LINEアカウントの乗り換え（引き継ぎ）。設計 ★V6 33-4（`nx3XW`）。台帳 #133。
--
-- **既存の account_migrations とは別物。** あちらは友だちを別のアカウントへ
-- 移すための表。こちらは「2つのアカウントをコードでつなぎ、突合してから
-- 本実行する」5段の流れを持つ。名前が似ているので混ぜないこと。

-- プロバイダー。**LINE の Messaging API は返さない**ので、運用者が
-- LINE Developers の画面を見て入れる。入っていないアカウントは
-- 「同じか違うか分からない」として扱い、同じだと決めつけない。
ALTER TABLE line_accounts ADD COLUMN provider_id TEXT;

CREATE TABLE IF NOT EXISTS account_handovers (
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

CREATE INDEX IF NOT EXISTS idx_account_handovers_from ON account_handovers (from_account_id);
CREATE INDEX IF NOT EXISTS idx_account_handovers_status ON account_handovers (status);

/*
  段4「競合の判断」。**決めた内容はあとから見返せる。**
  1行 = 引き継ぎ元の友だち1人ぶんの判断。
*/
CREATE TABLE IF NOT EXISTS account_handover_decisions (
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

CREATE INDEX IF NOT EXISTS idx_handover_decisions_handover
  ON account_handover_decisions (handover_id);
