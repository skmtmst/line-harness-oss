-- 予約メニューの受付条件。所要時間と料金しか持てず、
-- 「同時に何件受けるか」「いつまで受け付けるか」を画面から決められなかった。

-- 同じ時間帯に受けられる件数。既定1（従来の挙動）。
ALTER TABLE menus ADD COLUMN concurrent_capacity INTEGER NOT NULL DEFAULT 1;

-- 何日先まで予約を受けるか。NULL なら制限なし。
ALTER TABLE menus ADD COLUMN booking_window_days INTEGER;

-- 開始の何時間前で締め切るか。NULL なら直前まで受ける。
ALTER TABLE menus ADD COLUMN cutoff_hours_before INTEGER;

-- 開始の何時間前までキャンセルできるか。NULL なら制限なし。
ALTER TABLE menus ADD COLUMN cancel_deadline_hours_before INTEGER;

-- 予約時にお客様へ聞く質問。NULL なら質問しない。
ALTER TABLE menus ADD COLUMN intake_question TEXT;
