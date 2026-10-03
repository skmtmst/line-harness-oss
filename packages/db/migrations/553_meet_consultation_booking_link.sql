-- F6 Meet 相談と予約の結び付き。登録・取消・補償を予約IDと予約の版で
-- 条件付きにし、古い操作が後発の勝者の相談を更新・取消できないようにする。
-- 移行前の行は NULL のまま。NULL は版なし (従来どおり無条件) として扱う。
ALTER TABLE meet_consultations ADD COLUMN booking_id TEXT;
ALTER TABLE meet_consultations ADD COLUMN booking_version INTEGER;
