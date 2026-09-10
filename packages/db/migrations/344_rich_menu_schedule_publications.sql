-- E-08 (#621 独立レビュー再修正): 予約公開の外部LINE二重作成を防ぐための durable journal。
-- LINE成功後・D1記録前の停止で再実行しても、同じ予約はLINEへ作り直さない。
-- schedule_id + page_id で1行。run_id はどの実行が作ったかの追跡用。
-- kind で開始公開(publish)と終了復元(restore)を分ける。
CREATE TABLE IF NOT EXISTS rich_menu_schedule_publications (
  schedule_id      TEXT NOT NULL REFERENCES rich_menu_schedules(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL DEFAULT 'publish' CHECK (kind IN ('publish', 'restore')),
  page_id          TEXT NOT NULL,
  line_richmenu_id TEXT NOT NULL,
  run_id           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (schedule_id, kind, page_id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_publications_schedule
  ON rich_menu_schedule_publications (schedule_id, kind);
