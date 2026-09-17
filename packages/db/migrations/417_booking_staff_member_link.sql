-- N-411 (#866): 予約スタッフとログインユーザー(staff_members)の紐づけ。
-- `booking.staff.own` 権限を持つスタッフが「自分の勤務」として
-- 操作できる予約スタッフ行を特定するために使う。未紐づけ(NULL)は従来どおり。
ALTER TABLE staff ADD COLUMN staff_member_id TEXT;
CREATE INDEX IF NOT EXISTS idx_staff_member_link ON staff (staff_member_id);
