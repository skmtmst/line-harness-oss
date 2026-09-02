-- イベントの公開範囲とキャンセル待ち。
-- 承認制・リマインダ・公開は既にあるが、この2つが無かった。

-- 公開対象を絞るタグ。NULL なら友だち全員。
ALTER TABLE events ADD COLUMN visible_tag_id TEXT;

-- 定員に達したあとキャンセル待ちを受けるか。既定は受けない（従来どおり）。
ALTER TABLE events ADD COLUMN waitlist_enabled INTEGER NOT NULL DEFAULT 0;

-- 申込の締め切り（開始の何時間前まで）。NULL なら開始まで受ける。
ALTER TABLE events ADD COLUMN entry_cutoff_hours_before INTEGER;
