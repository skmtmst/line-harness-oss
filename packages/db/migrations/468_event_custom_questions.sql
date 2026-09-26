-- イベント申込のカスタム質問 (#841)。
-- 運営がイベントごとに質問を定義し、申込時の回答は既存の
-- event_bookings.answer_snapshot_json (migration 324) にそのまま載る。
-- 質問は配列JSONで保存する:
--   [{"id":"q1","label":"アレルギーはありますか","type":"text","required":true},
--    {"id":"q2","label":"参加人数に含まれる同伴者","type":"radio",
--     "required":false,"options":["なし","あり"]}]
-- type は text | textarea | radio | checkbox。radio/checkbox は options 必須。

ALTER TABLE events
  ADD COLUMN questions_json TEXT CHECK (
    questions_json IS NULL OR json_valid(questions_json)
  );
