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
-- 取得のたびに1つ増える世代。解放しても戻さない(単調増加)。
-- owner は解放・公開確定で NULL に戻るため、「自分のあとに誰かが取ったか」を
-- owner だけでは区別できない (NULL が「誰も取っていない」と「誰かが取って
-- 手放した」の両方を意味してしまう)。確定は世代一致を書込み条件にして、
-- 回収に負けた旧holderが確定できないようにする。
ALTER TABLE rich_menu_groups ADD COLUMN publishing_generation INTEGER NOT NULL DEFAULT 0;
