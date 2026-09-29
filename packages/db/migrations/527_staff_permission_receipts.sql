-- m23d R498: 権限保存の再送を要求キーで1回だけ受け付ける。
--
-- 保存の応答を見失った画面が同じ保存を送り直したとき、版を重ねたり
-- 保存後にログインし直した対象者のセッションを切ったりしないよう、
-- 受け付けた結果を要求キーごとに残す。付け足すだけ（既存の列・行は今の動き）。
-- 同じキーで内容が違う送り直しは受け付けず、版の照合（R499）は別に行う。

CREATE TABLE IF NOT EXISTS staff_permission_receipts (
  idempotency_key TEXT NOT NULL,
  staff_id        TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  request_hash    TEXT NOT NULL,
  policy_version  INTEGER NOT NULL,
  result          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (idempotency_key, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_permission_receipts_staff_v527
  ON staff_permission_receipts (staff_id, created_at DESC);
