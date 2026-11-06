-- 退会後90日の自動削除で、回答フォームの公開版を消せるようにする。
-- 公開版は UPDATE 禁止のまま（trg_form_versions_immutable は残す）。
-- 削除禁止だけ外す。アプリ側に版を消す処理は無く、消すのは自動削除だけ。
DROP TRIGGER IF EXISTS trg_form_versions_no_delete;
