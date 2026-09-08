-- E-08 (#621 司令塔裁定・案A): 実行開始直前のLINE実default固定とpublish lockのowner lease。
-- 「前のメニューへ戻す」は予約時でなく切替直前に実defaultを読み、captured/no_default
-- として rich_menu_schedules へ固定する。終了時は固定値へ戻し、captured対象が
-- 消えていたら勝手に解除せず恒久失敗に残す。no_defaultだけ明示解除する。
-- publishing lockはowner token+期限(10分)付きにし、期限切れは回収できるようにする。
-- 既存行は NULL のまま動き、予約の取得条件は変えない。
ALTER TABLE rich_menu_schedules ADD COLUMN restore_default_state TEXT
  CHECK (restore_default_state IN ('captured', 'no_default'));
ALTER TABLE rich_menu_schedules ADD COLUMN restore_default_line_id TEXT;
ALTER TABLE rich_menu_groups ADD COLUMN publishing_owner TEXT;
ALTER TABLE rich_menu_groups ADD COLUMN publishing_expires_at TEXT;
