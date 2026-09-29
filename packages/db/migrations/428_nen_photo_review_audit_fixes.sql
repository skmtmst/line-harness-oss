-- #931 写真レビュー監査の是正。
-- N-309: 審査画面で直した写真の向きを版つきで保存できるようにする。
-- N-313: 単体審査と通知再送へ再実行キーを載せ、連打・応答ロストの
--        やり直しが「別の担当者が更新しました」にならないようにする。
-- N-312: 「この人の次の投稿は必ず人が見る」の保存先を友だちへ足す。

ALTER TABLE nen_photo_submissions ADD COLUMN display_rotation INTEGER NOT NULL DEFAULT 0
  CHECK (display_rotation IN (0, 90, 180, 270));
ALTER TABLE nen_photo_submissions ADD COLUMN rotation_idempotency_key TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN notification_retry_key TEXT;

ALTER TABLE nen_photo_review_events ADD COLUMN idempotency_key TEXT;
-- 差戻し時の「再投稿をお願いする案内を添えるか」。通知再送で同じ文面を
-- 作り直すため、判断時の選択をイベントへ残す。既存行は案内ありと同じ 1。
ALTER TABLE nen_photo_review_events ADD COLUMN resubmit_invite INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_nen_photo_review_events_v428_idempotency
  ON nen_photo_review_events(line_account_id, photo_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE friends ADD COLUMN photo_watch_required INTEGER NOT NULL DEFAULT 0;
