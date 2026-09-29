-- 機能05 点検（N-057）: テスト送信の送信先単位デバウンス。
--
-- 連打・複数タブ・同時リクエストで同じ友だちへ同じテストが立て続けに
-- 実送信されるのを止める。画面の送信中フラグだけでは別タブを防げない
-- ため、送る前にサーバー側で原子に claim する。

CREATE TABLE IF NOT EXISTS scenario_test_send_claims (
  claim_key TEXT PRIMARY KEY,
  claimed_at TEXT NOT NULL
);
