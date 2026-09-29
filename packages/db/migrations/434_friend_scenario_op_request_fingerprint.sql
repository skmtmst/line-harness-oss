-- #949 監査是正: 購読操作の確認キー台帳へ、操作本体（リクエスト）の写しを残す。
--
-- 直す前は 購読ID + 操作種別 だけで照合していたため、move で同じキーを
-- 別の移し先へ送り直すと、先に残った成功応答がそのまま返ってしまった。
-- scenario_publish_keys の content_snapshot と同じ考え方で、本体の写しが
-- 違う同キー再送は 409 にする。
-- 既存行は NULL（写し不明）のまま残し、再送時は写し不一致として 409 に
-- 倒す（fail-closed）。
ALTER TABLE friend_scenario_op_keys ADD COLUMN request_fingerprint TEXT;
