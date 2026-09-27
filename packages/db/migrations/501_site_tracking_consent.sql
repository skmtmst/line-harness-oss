-- H: サイト計測の同意 (#818)
-- 同意する前の閲覧は site_events に残さない。代わりに日ごとの件数だけを数えて、
-- 「同意がなくて数えなかった件数」と「同意した割合」を管理画面に出せるようにする。

ALTER TABLE site_visitors
  ADD COLUMN consent_state TEXT CHECK (consent_state IS NULL OR consent_state IN ('granted', 'declined'));
ALTER TABLE site_visitors
  ADD COLUMN consent_at TEXT;

-- 同意の結果と、同意がなくて数えなかった受信を日ごとに数えるだけの台帳。
-- 個人やページの情報は持たず、アカウントと日付ごとの件数だけを持つ。
--   suppressed … 同意前・拒否のまま届いた、記録しなかった回数
--   granted    … 「記録してよい」を選んだ数
--   declined   … 「記録しない」を選んだ数
CREATE TABLE site_consent_days (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  day             TEXT NOT NULL,
  suppressed      INTEGER NOT NULL DEFAULT 0,
  granted         INTEGER NOT NULL DEFAULT 0,
  declined        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (line_account_id, day)
);
