-- 成果地点の計測条件。これまで名前・種別・金額しか持てず、
-- 「どうやって数えるか」「重複をどう扱うか」を画面から決められなかった。

-- url_reach / webhook / manual のいずれか。既定は従来の扱いに合わせて manual。
ALTER TABLE conversion_points ADD COLUMN measure_method TEXT NOT NULL DEFAULT 'manual'
  CHECK (measure_method IN ('url_reach', 'webhook', 'manual'));

-- url_reach のときの対象URL（前方一致で判定する想定）。
ALTER TABLE conversion_points ADD COLUMN target_url TEXT;

-- 同じ人を何度数えるか。既定は毎回（従来どおり）。
ALTER TABLE conversion_points ADD COLUMN count_repeat INTEGER NOT NULL DEFAULT 1;

-- 友だち追加から何日以内の成果を紐づけるか。NULL なら期限なし。
ALTER TABLE conversion_points ADD COLUMN attribution_days INTEGER;

-- 集計対象を1アカウントに絞る場合。NULL なら全アカウント。
ALTER TABLE conversion_points ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;
