-- 草稿: オーナーの番号承認・適用承認までは D1 に適用しない。
-- 既存の型のCHECK制約や関連する値・移行履歴を変えず、時刻だけを追加する。
-- 読むときは type_v8 → type_v6 → type の順で解決する。時刻の旧列はtext。
ALTER TABLE friend_fields ADD COLUMN type_v8 TEXT
  CHECK (type_v8 IS NULL OR type_v8 = 'time');
